import assert from 'node:assert/strict';
import test from 'node:test';

import { JSONPointer, ModifyData } from '@beingenious/jsonpointer';

import { subscribeToChangeAuth } from '../src/hooks/useFirebaseWithBridge/changeActionController.mjs';
import { createChangeRuntime } from '../src/hooks/useFirebaseWithBridge/createChangeRuntime.mjs';
import { FakeFieldPath, FakeFieldValue as FieldValue } from './firestoreFakes.mjs';

const settle = () => new Promise((resolve) => setImmediate(resolve));

const createFakeFirestore = () => {
  const state = {
    listeners: new Map(), // uid -> { onNext, onError }
    subscriptions: [],
    updates: [],
    sets: [],
    pendingWrites: [],
    unsubscribed: [],
    cacheResult: { exists: true, data: () => ({}) },
  };
  const firestore = {
    collection: () => ({
      doc: (uid) => ({
        onSnapshot: (options, onNext, onError) => {
          state.listeners.set(uid, { onNext, onError });
          state.subscriptions.push(uid);
          return () => state.unsubscribed.push(uid);
        },
        get: ({ source }) => {
          assert.equal(source, 'cache');
          return Promise.resolve(state.cacheResult);
        },
        update: (...args) => {
          state.updates.push({ uid, args });
          return new Promise((resolve, reject) => {
            state.pendingWrites.push({ resolve, reject });
          });
        },
        set: (...args) => {
          state.sets.push({ uid, args });
          return new Promise((resolve, reject) => {
            state.pendingWrites.push({ resolve, reject });
          });
        },
      }),
    }),
    runTransaction: () => {
      throw new Error('runTransaction must never be called');
    },
  };
  const emitSnapshot = (uid, { exists, fromCache, data }) => {
    state.listeners.get(uid).onNext({
      exists,
      metadata: { fromCache, hasPendingWrites: false },
      data: () => data,
    });
  };
  const emitListenerError = (uid, error) => {
    state.listeners.get(uid).onError(error);
  };
  return { firestore, state, emitSnapshot, emitListenerError };
};

test('runtime rebases transforms locally without any transaction', async () => {
  const { firestore, state, emitSnapshot } = createFakeFirestore();
  const errors = [];
  const runtime = createChangeRuntime({
    firestore,
    FieldValue,
    FieldPath: FakeFieldPath,
    JSONPointer,
    ModifyData,
    sendChangeError: (code, message) => errors.push({ code, message }),
    language: 'en_US',
  });

  runtime.setUser({ uid: 'u1' });
  emitSnapshot('u1', { exists: true, fromCache: false, data: { count: 1 } });

  runtime.enqueue({
    uid: 'u1',
    modify: { property: '/count', func: 'inc', value: 1 },
  });
  runtime.enqueue({
    uid: 'u1',
    modify: { property: '/count', func: 'inc', value: 1 },
  });
  await settle();

  assert.equal(state.updates.length, 2);
  assert.deepEqual(state.updates[0].args, [
    'count',
    { real: 'increment', n: 1 },
  ]);
  // Both writes stay atomic; the second only waits for the local cache view.
  assert.deepEqual(state.updates[1].args, [
    'count',
    { real: 'increment', n: 1 },
  ]);
  assert.deepEqual(errors, []);
});

test('user switch unsubscribes the old listener and isolates queues', () => {
  const { firestore, state, emitSnapshot } = createFakeFirestore();
  const runtime = createChangeRuntime({
    firestore,
    FieldValue,
    FieldPath: FakeFieldPath,
    JSONPointer,
    ModifyData,
    sendChangeError: () => {},
    language: 'en_US',
  });

  runtime.setUser({ uid: 'u1' });
  runtime.enqueue({
    uid: 'u1',
    modify: { property: '/a', func: 'set', value: 1 },
  });

  runtime.setUser({ uid: 'u2' });
  assert.deepEqual(state.unsubscribed, ['u1']);

  emitSnapshot('u2', { exists: true, fromCache: false, data: {} });
  assert.equal(state.updates.length, 0, 'u1 action must not reach u2');

  runtime.dispose();
  assert.deepEqual(state.unsubscribed, ['u1', 'u2']);
});

test('an ID-token refresh restores the same-UID listener after a terminal error', () => {
  const { firestore, state, emitSnapshot, emitListenerError } =
    createFakeFirestore();
  const errors = [];
  const runtime = createChangeRuntime({
    firestore,
    FieldValue,
    FieldPath: FakeFieldPath,
    JSONPointer,
    ModifyData,
    sendChangeError: (code, message) => errors.push({ code, message }),
    language: 'en_US',
  });

  const user = { uid: 'u1' };
  let emitIdTokenChanged;
  subscribeToChangeAuth({
    auth: {
      currentUser: user,
      onIdTokenChanged: (listener) => {
        emitIdTokenChanged = listener;
        return () => {};
      },
    },
    setUser: (nextUser) => runtime.setUser(nextUser),
    syncAuth: () => {},
  });

  runtime.enqueue({
    uid: 'u1',
    modify: { property: '/queued', func: 'set', value: true },
  });

  const listenerError = Object.assign(new Error('denied'), {
    code: 'permission-denied',
  });
  emitListenerError('u1', listenerError);

  assert.deepEqual(errors, [{ code: 'permission-denied', message: 'denied' }]);
  assert.equal(state.updates.length, 0);

  runtime.enqueue({
    uid: 'u1',
    modify: { property: '/blocked', func: 'set', value: true },
  });
  assert.equal(errors.at(-1).code, 'change/listener-unavailable');

  emitIdTokenChanged(user);
  assert.deepEqual(state.subscriptions, ['u1', 'u1']);
  emitSnapshot('u1', { exists: true, fromCache: false, data: {} });
  runtime.enqueue({
    uid: 'u1',
    modify: { property: '/fresh', func: 'set', value: true },
  });

  assert.equal(state.updates.length, 1);
  assert.deepEqual(state.updates[0].args, ['fresh', true]);
});

test('a terminal listener error preserves failures from already-submitted writes', async () => {
  const { firestore, state, emitSnapshot, emitListenerError } =
    createFakeFirestore();
  const errors = [];
  const runtime = createChangeRuntime({
    firestore,
    FieldValue,
    FieldPath: FakeFieldPath,
    JSONPointer,
    ModifyData,
    sendChangeError: (code, message) => errors.push({ code, message }),
    language: 'en_US',
  });

  runtime.setUser({ uid: 'u1' });
  emitSnapshot('u1', { exists: true, fromCache: false, data: {} });
  runtime.enqueue({
    uid: 'u1',
    modify: { property: '/a', func: 'set', value: 1 },
  });
  runtime.enqueue({
    uid: 'u1',
    modify: { property: '/b', func: 'set', value: 2 },
  });
  assert.equal(state.pendingWrites.length, 2);

  emitListenerError(
    'u1',
    Object.assign(new Error('listener denied'), {
      code: 'permission-denied',
    }),
  );
  state.pendingWrites[0].reject(
    Object.assign(new Error('write a denied'), {
      code: 'permission-denied',
    }),
  );
  state.pendingWrites[1].reject(
    Object.assign(new Error('write b denied'), {
      code: 'permission-denied',
    }),
  );
  await settle();

  assert.deepEqual(errors, [
    { code: 'permission-denied', message: 'listener denied' },
    { code: 'permission-denied', message: 'write a denied' },
    { code: 'permission-denied', message: 'write b denied' },
  ]);
});
