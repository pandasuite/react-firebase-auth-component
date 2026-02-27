import assert from 'node:assert/strict';
import test from 'node:test';

import { createChangeActionController } from '../src/hooks/useFirebaseWithBridge/changeActionController.mjs';

const createFakeScheduler = () => {
  const timers = [];
  return {
    schedule: (fn, delay) => {
      const entry = { fn, delay, canceled: false };
      timers.push(entry);
      return entry;
    },
    clearScheduled: (entry) => {
      if (entry) {
        entry.canceled = true;
      }
    },
    timers,
  };
};

test('controller queues during auth bootstrap and flushes when auth becomes ready', () => {
  const applied = [];
  const errors = [];
  const scheduler = createFakeScheduler();

  const controller = createChangeActionController({
    applyChange: ({ user, modify }) => {
      applied.push({ user, modify });
    },
    sendChangeError: (code, message) => {
      errors.push({ code, message });
    },
    schedule: scheduler.schedule,
    clearScheduled: scheduler.clearScheduled,
  });

  controller.handleIncomingChange({
    auth: null,
    payload: { property: '/profile/name', func: 'set', value: 'Ben' },
  });

  assert.equal(applied.length, 0);
  assert.equal(errors.length, 0);
  assert.equal(scheduler.timers.length, 1);

  const user = { uid: 'u1' };
  controller.syncAuth({ currentUser: user });

  assert.deepEqual(applied, [
    {
      user,
      modify: { property: '/profile/name', func: 'set', value: 'Ben' },
    },
  ]);
  assert.equal(errors.length, 0);
});

test('controller keeps pending changes across transient signed-out and flushes when ready', () => {
  const applied = [];
  const errors = [];

  const controller = createChangeActionController({
    applyChange: ({ user, modify }) => {
      applied.push({ user, modify });
    },
    sendChangeError: (code, message) => {
      errors.push({ code, message });
    },
  });

  controller.handleIncomingChange({
    auth: null,
    payload: { property: '/profile/name', func: 'set', value: 'Ben' },
  });

  // Firebase can report currentUser=null before restoring the session.
  controller.syncAuth({ currentUser: null });

  assert.equal(applied.length, 0);
  assert.equal(errors.length, 0);

  controller.syncAuth({ currentUser: { uid: 'u1' } });

  assert.equal(applied.length, 1);
  assert.equal(errors.length, 0);
});

test('controller emits immediate not-signed-in error for direct signed-out changes', () => {
  const errors = [];

  const controller = createChangeActionController({
    applyChange: () => {},
    sendChangeError: (code, message) => {
      errors.push({ code, message });
    },
  });

  controller.handleIncomingChange({
    auth: { currentUser: null },
    payload: { property: '/profile/name', func: 'set', value: 'Ben' },
  });

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'auth/not-signed-in');
});

test('controller emits timeout error when queued change waits too long', () => {
  const errors = [];
  const scheduler = createFakeScheduler();

  const controller = createChangeActionController({
    applyChange: () => {},
    sendChangeError: (code, message) => {
      errors.push({ code, message });
    },
    schedule: scheduler.schedule,
    clearScheduled: scheduler.clearScheduled,
    timeoutMs: 250,
  });

  controller.handleIncomingChange({
    auth: null,
    payload: { property: '/profile/name', func: 'set', value: 'Ben' },
  });

  assert.equal(scheduler.timers.length, 1);
  assert.equal(scheduler.timers[0].delay, 250);

  scheduler.timers[0].fn();

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'auth/wait-timeout');
});
