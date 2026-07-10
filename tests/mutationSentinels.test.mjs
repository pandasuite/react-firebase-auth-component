import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyUpdateToDoc,
  isSentinel,
  plannerFieldValue,
  toFirestoreValue,
} from '../src/hooks/useFirebaseWithBridge/mutationSentinels.mjs';
import { FIELD_PATH_UPDATES } from '../src/hooks/useFirebaseWithBridge/modifyDataAdapter.mjs';

test('increment adds to any number and replaces non-numbers, like Firestore', () => {
  assert.deepEqual(
    applyUpdateToDoc({
      doc: { n: 5 },
      update: { n: plannerFieldValue.increment(2) },
    }),
    { n: 7 },
  );
  // IEEE arithmetic on non-finite numbers matches Firestore's local result.
  assert.ok(
    Number.isNaN(
      applyUpdateToDoc({
        doc: { n: NaN },
        update: { n: plannerFieldValue.increment(2) },
      }).n,
    ),
  );
  assert.deepEqual(
    applyUpdateToDoc({
      doc: { n: Infinity },
      update: { n: plannerFieldValue.increment(2) },
    }),
    { n: Infinity },
  );
  assert.deepEqual(
    applyUpdateToDoc({
      doc: { n: 'x' },
      update: { n: plannerFieldValue.increment(2) },
    }),
    { n: 2 },
  );
  assert.deepEqual(
    applyUpdateToDoc({
      doc: {},
      update: { n: plannerFieldValue.increment(2) },
    }),
    { n: 2 },
  );
});

test('a nested delete through a missing or non-map parent leaves the document untouched', () => {
  // Firestore ignores `a.b: delete()` when `a` is a scalar or missing; the
  // simulation must not materialize `a` as an empty map.
  assert.deepEqual(
    applyUpdateToDoc({
      doc: { a: 5 },
      update: { 'a.b': plannerFieldValue.delete() },
    }),
    { a: 5 },
  );
  assert.deepEqual(
    applyUpdateToDoc({
      doc: {},
      update: { 'a.b': plannerFieldValue.delete() },
    }),
    {},
  );
});

test('delete removes the field', () => {
  assert.deepEqual(
    applyUpdateToDoc({
      doc: { a: 1, b: 2 },
      update: { a: plannerFieldValue.delete() },
    }),
    { b: 2 },
  );
  assert.deepEqual(
    applyUpdateToDoc({
      doc: { profile: { 'a.b': 1, keep: true } },
      update: {
        [FIELD_PATH_UPDATES]: [
          {
            segments: ['profile', 'a.b'],
            value: plannerFieldValue.delete(),
          },
        ],
      },
    }),
    { profile: { keep: true } },
  );
});

test('arrayUnion deduplicates by deep equality, arrayRemove removes every match', () => {
  assert.deepEqual(
    applyUpdateToDoc({
      doc: { arr: [{ v: 1 }] },
      update: { arr: plannerFieldValue.arrayUnion({ v: 1 }, { v: 2 }) },
    }),
    { arr: [{ v: 1 }, { v: 2 }] },
  );
  assert.deepEqual(
    applyUpdateToDoc({
      doc: { arr: [{ v: 1 }, { v: 2 }, { v: 1 }] },
      update: { arr: plannerFieldValue.arrayRemove({ v: 1 }) },
    }),
    { arr: [{ v: 2 }] },
  );
  // Non-array current value: union/remove replace it, like Firestore does.
  assert.deepEqual(
    applyUpdateToDoc({
      doc: { arr: 3 },
      update: { arr: plannerFieldValue.arrayUnion(1) },
    }),
    { arr: [1] },
  );
  assert.deepEqual(
    applyUpdateToDoc({
      doc: { arr: 3 },
      update: { arr: plannerFieldValue.arrayRemove(1) },
    }),
    { arr: [] },
  );
});

test('string paths walk literal keys and never create arrays', () => {
  assert.deepEqual(applyUpdateToDoc({ doc: {}, update: { 'a.b': 1 } }), {
    a: { b: 1 },
  });
});

test('new documents and nested maps have ordinary object prototypes', () => {
  const next = applyUpdateToDoc({ doc: null, update: { 'a.b': 1 } });

  assert.equal(Object.getPrototypeOf(next), Object.prototype);
  assert.equal(Object.getPrototypeOf(next.a), Object.prototype);
  assert.deepEqual(next, { a: { b: 1 } });
});

test('prototype-chain paths cannot pollute global objects', () => {
  delete Object.prototype.polluted;

  try {
    const next = applyUpdateToDoc({
      doc: {},
      update: { '__proto__.polluted': true },
    });

    assert.equal(Object.prototype.polluted, undefined);
    assert.deepEqual(next, {});
  } finally {
    delete Object.prototype.polluted;
  }
});

test('FIELD_PATH_UPDATES segments treat dots as literal key characters', () => {
  const update = {
    [FIELD_PATH_UPDATES]: [{ segments: ['profile', 'a.b'], value: 2 }],
  };
  assert.deepEqual(
    applyUpdateToDoc({ doc: { profile: { 'a.b': 1, keep: true } }, update }),
    { profile: { 'a.b': 2, keep: true } },
  );
});

test('applyUpdateToDoc never mutates its inputs', () => {
  const doc = { a: { b: 1 }, arr: [1] };
  applyUpdateToDoc({
    doc,
    update: { 'a.b': 2, arr: plannerFieldValue.arrayUnion(2) },
  });
  assert.deepEqual(doc, { a: { b: 1 }, arr: [1] });
});

test('a sentinel-looking literal is not a planner sentinel', () => {
  assert.equal(isSentinel({ __pandaFsSentinel: 'delete', keep: 1 }), false);
});

test('applyUpdateToDoc writes a sentinel-looking literal as data', () => {
  const literal = { __pandaFsSentinel: 'delete', keep: 1 };

  assert.deepEqual(
    applyUpdateToDoc({
      doc: { payload: { old: true } },
      update: { payload: literal },
    }),
    { payload: literal },
  );
});

test('toFirestoreValue passes a sentinel-looking literal through unchanged', () => {
  const literal = { __pandaFsSentinel: 'delete', keep: 1 };
  const FieldValue = { delete: () => ({ real: 'delete' }) };

  assert.strictEqual(toFirestoreValue(literal, FieldValue), literal);
});

test('toFirestoreValue maps sentinels to the injected FieldValue', () => {
  const calls = [];
  const FieldValue = {
    increment: (n) => calls.push(['increment', n]) && 'INC',
    delete: () => calls.push(['delete']) && 'DEL',
    arrayUnion: (...v) => calls.push(['arrayUnion', v]) && 'AU',
    arrayRemove: (...v) => calls.push(['arrayRemove', v]) && 'AR',
  };

  assert.equal(
    toFirestoreValue(plannerFieldValue.increment(3), FieldValue),
    'INC',
  );
  assert.equal(toFirestoreValue(plannerFieldValue.delete(), FieldValue), 'DEL');
  assert.equal(
    toFirestoreValue(plannerFieldValue.arrayUnion(1, 2), FieldValue),
    'AU',
  );
  assert.equal(
    toFirestoreValue(plannerFieldValue.arrayRemove(1), FieldValue),
    'AR',
  );
  assert.equal(toFirestoreValue({ plain: true }, FieldValue).plain, true);
  assert.equal(isSentinel(plannerFieldValue.delete()), true);
  assert.equal(isSentinel({ plain: true }), false);
  assert.deepEqual(calls, [
    ['increment', 3],
    ['delete'],
    ['arrayUnion', [1, 2]],
    ['arrayRemove', [1]],
  ]);
});
