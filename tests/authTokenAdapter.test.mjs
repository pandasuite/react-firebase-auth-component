import assert from 'node:assert/strict';
import test from 'node:test';

import { toAuthTokenGeneratedPayload } from '../src/hooks/useFirebaseWithBridge/authTokenAdapter.mjs';

test('toAuthTokenGeneratedPayload uses claims.exp when present', () => {
  const payload = toAuthTokenGeneratedPayload({
    token: 'header.payload.signature',
    claims: { exp: 1735689600 },
    expirationTime: '2025-01-01T00:00:00.000Z',
  });

  assert.deepEqual(payload, {
    token: 'header.payload.signature',
    expiresAt: {
      type: 'Date',
      value: 1735689600,
    },
  });
});

test('toAuthTokenGeneratedPayload falls back to expirationTime when claims.exp is missing', () => {
  const payload = toAuthTokenGeneratedPayload({
    token: 'header.payload.signature',
    claims: {},
    expirationTime: '2025-01-01T00:00:00.000Z',
  });

  assert.deepEqual(payload, {
    token: 'header.payload.signature',
    expiresAt: {
      type: 'Date',
      value: 1735689600,
    },
  });
});

test('toAuthTokenGeneratedPayload accepts string exp claims', () => {
  const payload = toAuthTokenGeneratedPayload({
    token: 'header.payload.signature',
    claims: { exp: '1735689600' },
  });

  assert.deepEqual(payload, {
    token: 'header.payload.signature',
    expiresAt: {
      type: 'Date',
      value: 1735689600,
    },
  });
});

test('toAuthTokenGeneratedPayload returns null when expiration is unavailable', () => {
  const payload = toAuthTokenGeneratedPayload({
    token: 'header.payload.signature',
    claims: {},
    expirationTime: 'not-a-date',
  });

  assert.equal(payload, null);
});

test('toAuthTokenGeneratedPayload returns null when token is missing', () => {
  const payload = toAuthTokenGeneratedPayload({
    claims: { exp: 1735689600 },
  });

  assert.equal(payload, null);
});
