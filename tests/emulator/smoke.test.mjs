import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearEmulatorData,
  createEmulatorClient,
  deleteAllApps,
} from './helpers.mjs';

test('two clients incrementing the same number produce the sum of both transforms', async () => {
  await clearEmulatorData();
  const a = createEmulatorClient();
  const b = createEmulatorClient();
  try {
    const refA = a.firestore.collection('users').doc('smoke-user');
    const refB = b.firestore.collection('users').doc('smoke-user');

    await refA.set({ count: 0 });
    await Promise.all([
      refA.update({ count: a.FieldValue.increment(2) }),
      refB.update({ count: b.FieldValue.increment(3) }),
    ]);

    const snapshot = await refA.get();
    assert.equal(snapshot.data().count, 5);
  } finally {
    await deleteAllApps();
  }
});
