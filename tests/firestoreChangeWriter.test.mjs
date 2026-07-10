import assert from 'node:assert/strict';
import test from 'node:test';

import { createFirestoreChangeWriter } from '../src/hooks/useFirebaseWithBridge/firestoreChangeWriter.mjs';
import { FIELD_PATH_UPDATES } from '../src/hooks/useFirebaseWithBridge/modifyDataAdapter.mjs';
import { plannerFieldValue } from '../src/hooks/useFirebaseWithBridge/mutationSentinels.mjs';
import { FakeFieldPath, FakeFieldValue } from './firestoreFakes.mjs';

const createHarness = () => {
  const calls = [];
  const updatePromise = Promise.resolve('updated');
  const docRef = {
    update: (...args) => {
      calls.push({ method: 'update', args });
      return updatePromise;
    },
  };
  const writer = createFirestoreChangeWriter({
    FieldValue: FakeFieldValue,
    FieldPath: FakeFieldPath,
  });
  return { writer, docRef, calls, updatePromise };
};

test('targeted writes become one varargs update call with converted sentinels', async () => {
  const { writer, docRef, calls } = createHarness();
  await writer.submit({
    docRef,
    plan: {
      kind: 'atomic-transform',
      update: {
        count: plannerFieldValue.increment(2),
        name: 'bob',
      },
      expectedDoc: {},
    },
  });

  const update = calls[0];
  assert.equal(update.method, 'update');
  assert.deepEqual(update.args, [
    'count',
    { real: 'increment', n: 2 },
    'name',
    'bob',
  ]);
});

test('FIELD_PATH_UPDATES convert branded sentinels, preserve literal data, and return the update promise', async () => {
  const literal = { __pandaFsSentinel: 'delete', keep: 1 };
  const { writer, docRef, calls, updatePromise } = createHarness();
  const submitted = writer.submit({
    docRef,
    plan: {
      kind: 'targeted-write',
      update: {
        [FIELD_PATH_UPDATES]: [
          {
            segments: ['profile', 'a.b'],
            value: plannerFieldValue.increment(2),
          },
          { segments: ['profile', 'literal'], value: literal },
        ],
      },
      expectedDoc: {},
    },
  });
  assert.strictEqual(submitted, updatePromise);
  await submitted;

  const update = calls[0];
  assert.equal(update.method, 'update');
  assert.ok(update.args[0] instanceof FakeFieldPath);
  assert.deepEqual(update.args[0].segments, ['profile', 'a.b']);
  assert.deepEqual(update.args[1], { real: 'increment', n: 2 });
  assert.ok(update.args[2] instanceof FakeFieldPath);
  assert.deepEqual(update.args[2].segments, ['profile', 'literal']);
  assert.strictEqual(update.args[3], literal);
});

test('an empty update resolves without calling Firestore', async () => {
  const { writer, docRef, calls } = createHarness();
  await writer.submit({
    docRef,
    plan: { kind: 'targeted-write', update: {}, expectedDoc: {} },
  });
  assert.equal(calls.length, 0);
});
