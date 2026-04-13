import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureUserDocument } from '../src/hooks/useFirebaseWithBridge/userDocument.mjs';

test('ensureUserDocument writes to users/{uid} with merge semantics', async () => {
  const calls = [];
  const firestore = {
    collection: (name) => ({
      doc: (uid) => ({
        set: async (data, options) => {
          calls.push({ name, uid, data, options });
        },
      }),
    }),
  };

  const result = await ensureUserDocument({
    firestore,
    uid: 'user-123',
    data: {
      email: 'ben@example.com',
    },
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [
    {
      name: 'users',
      uid: 'user-123',
      data: {
        email: 'ben@example.com',
      },
      options: { merge: true },
    },
  ]);
});

test('ensureUserDocument returns false when firestore, uid, or data are missing', async () => {
  assert.equal(
    await ensureUserDocument({ firestore: null, uid: 'u1', data: {} }),
    false,
  );
  assert.equal(
    await ensureUserDocument({ firestore: {}, uid: '', data: {} }),
    false,
  );
  assert.equal(
    await ensureUserDocument({ firestore: {}, uid: 'u1', data: null }),
    false,
  );
});
