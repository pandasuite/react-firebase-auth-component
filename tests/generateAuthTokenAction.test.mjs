import assert from 'node:assert/strict';
import test from 'node:test';

import { generateAuthTokenAction } from '../src/hooks/useFirebaseWithBridge/generateAuthTokenAction.mjs';

test('generateAuthTokenAction is a safe no-op when auth is null', async () => {
  const sentEvents = [];

  const result = await generateAuthTokenAction({
    auth: null,
    forceRefresh: true,
    send: (name, payload) => {
      sentEvents.push({ name, payload });
    },
  });

  assert.equal(result, false);
  assert.deepEqual(sentEvents, []);
});

test('generateAuthTokenAction returns false when currentUser is null', async () => {
  const result = await generateAuthTokenAction({
    auth: { currentUser: null },
    forceRefresh: false,
    send: () => { throw new Error('should not be called'); },
  });

  assert.equal(result, false);
});

test('generateAuthTokenAction sends payload on success', async () => {
  const sentEvents = [];
  const auth = {
    currentUser: {
      getIdTokenResult: async () => ({
        token: 'abc.def.ghi',
        claims: { exp: 1735689600 },
        expirationTime: '2025-01-01T00:00:00.000Z',
      }),
    },
  };

  const result = await generateAuthTokenAction({
    auth,
    forceRefresh: false,
    send: (name, args) => sentEvents.push({ name, args }),
  });

  assert.equal(result, true);
  assert.equal(sentEvents.length, 1);
  assert.equal(sentEvents[0].name, 'onAuthTokenGenerated');
  assert.deepEqual(sentEvents[0].args[0], {
    token: 'abc.def.ghi',
    expiresAt: { type: 'Date', value: 1735689600 },
  });
});

test('generateAuthTokenAction calls onError when getIdTokenResult rejects', async () => {
  const errors = [];
  const auth = {
    currentUser: {
      getIdTokenResult: async () => { throw new Error('network failure'); },
    },
  };

  const result = await generateAuthTokenAction({
    auth,
    forceRefresh: true,
    send: () => { throw new Error('should not be called'); },
    onError: (...args) => errors.push(args),
  });

  assert.equal(result, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /Error generating auth token/);
});

test('generateAuthTokenAction calls onError when payload is null', async () => {
  const errors = [];
  const auth = {
    currentUser: {
      getIdTokenResult: async () => ({ token: '', claims: {} }),
    },
  };

  const result = await generateAuthTokenAction({
    auth,
    forceRefresh: false,
    send: () => { throw new Error('should not be called'); },
    onError: (...args) => errors.push(args),
  });

  assert.equal(result, false);
  assert.equal(errors.length, 1);
});
