import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHANGE_QUEUE_MAX,
  describeChangeAuthState,
  queueChangeModify,
  resolvePendingChangePolicy,
  toQueuedChangeModify,
} from '../src/hooks/useFirebaseWithBridge/changeActionQueue.mjs';

test('toQueuedChangeModify returns null for invalid payloads', () => {
  assert.equal(toQueuedChangeModify(null), null);
  assert.equal(toQueuedChangeModify('nope'), null);
  assert.equal(toQueuedChangeModify({}), null);
  assert.equal(toQueuedChangeModify({ property: null }), null);
});

test('toQueuedChangeModify keeps property/func/value for valid payloads', () => {
  assert.deepEqual(
    toQueuedChangeModify({
      property: '/items/@getById:42/name',
      func: 'set',
      value: 'updated',
    }),
    {
      property: '/items/@getById:42/name',
      func: 'set',
      value: 'updated',
    },
  );
});

test('describeChangeAuthState classifies auth bootstrap states', () => {
  assert.equal(describeChangeAuthState(false), 'invalid-config');
  assert.equal(describeChangeAuthState(null), 'waiting-for-auth');
  assert.equal(describeChangeAuthState(undefined), 'waiting-for-auth');
  assert.equal(describeChangeAuthState({ currentUser: null }), 'signed-out');
  assert.equal(
    describeChangeAuthState({ currentUser: { uid: 'u1' } }),
    'ready',
  );
});

test('queueChangeModify appends to queue until max is reached', () => {
  const first = queueChangeModify({
    queue: [],
    modify: { property: '/a', func: 'set', value: 1 },
    maxSize: 2,
  });
  assert.equal(first.dropped, false);
  assert.deepEqual(first.queue, [{ property: '/a', func: 'set', value: 1 }]);

  const second = queueChangeModify({
    queue: first.queue,
    modify: { property: '/b', func: 'set', value: 2 },
    maxSize: 2,
  });
  assert.equal(second.dropped, false);
  assert.deepEqual(second.queue, [
    { property: '/a', func: 'set', value: 1 },
    { property: '/b', func: 'set', value: 2 },
  ]);
});

test('queueChangeModify drops oldest item when queue is full', () => {
  const result = queueChangeModify({
    queue: [
      { property: '/a', func: 'set', value: 1 },
      { property: '/b', func: 'set', value: 2 },
    ],
    modify: { property: '/c', func: 'set', value: 3 },
    maxSize: 2,
  });

  assert.equal(result.dropped, true);
  assert.deepEqual(result.queue, [
    { property: '/b', func: 'set', value: 2 },
    { property: '/c', func: 'set', value: 3 },
  ]);
});

test('default queue max is stable', () => {
  assert.equal(CHANGE_QUEUE_MAX, 50);
});

test('resolvePendingChangePolicy returns deterministic outcomes for pending queue', () => {
  assert.equal(
    resolvePendingChangePolicy({
      authState: 'waiting-for-auth',
      hasPendingChanges: true,
    }),
    'noop',
  );
  assert.equal(
    resolvePendingChangePolicy({
      authState: 'ready',
      hasPendingChanges: true,
    }),
    'flush',
  );
  assert.equal(
    resolvePendingChangePolicy({
      authState: 'invalid-config',
      hasPendingChanges: true,
    }),
    'fail-invalid-config',
  );
  assert.equal(
    resolvePendingChangePolicy({
      authState: 'signed-out',
      hasPendingChanges: true,
    }),
    'noop',
  );
  assert.equal(
    resolvePendingChangePolicy({
      authState: 'signed-out',
      hasPendingChanges: false,
    }),
    'noop',
  );
});
