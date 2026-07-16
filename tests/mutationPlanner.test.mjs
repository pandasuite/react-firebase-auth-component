import assert from 'node:assert/strict';
import test from 'node:test';

import { JSONPointer, ModifyData } from '@beingenious/jsonpointer';

import { planChange } from '../src/hooks/useFirebaseWithBridge/mutationPlanner.mjs';

const plan = (modify, userDoc) =>
  planChange({ JSONPointer, ModifyData, modify, userDoc, language: 'en_US' });

test('malformed action is invalid with a stable reason', () => {
  assert.deepEqual(plan(null, {}), {
    kind: 'invalid',
    reason: 'change/malformed-action',
  });
  assert.deepEqual(plan({ func: 'set', value: 1 }, {}), {
    kind: 'invalid',
    reason: 'change/malformed-action',
  });
  assert.deepEqual(plan({ property: '/x', func: 123, value: 1 }, {}), {
    kind: 'invalid',
    reason: 'change/malformed-action',
  });
});

test('unparseable pointer is invalid, unmatched selector is a noop', () => {
  assert.equal(plan({ property: 42, func: 'set', value: 1 }, {}).kind, 'invalid');
  assert.equal(
    plan(
      { property: '/rows/@find:id|eq|missing/v', func: 'set', value: 1 },
      { rows: [{ id: '1', v: 1 }] },
    ).kind,
    'noop',
  );
});

test('set on a stable field returns a targeted write and the expected document', () => {
  const result = plan({ property: '/name', func: 'set', value: 'b' }, { name: 'a' });
  assert.equal(result.kind, 'targeted-write');
  assert.deepEqual(result.update, { name: 'b' });
  assert.deepEqual(result.expectedDoc, { name: 'b' });
});

test('set preserves a sentinel-looking literal in the write and expected document', () => {
  const literal = { __pandaFsSentinel: 'delete', keep: 1 };
  const result = plan(
    { property: '/payload', func: 'set', value: literal },
    { payload: { old: true } },
  );

  assert.equal(result.kind, 'targeted-write');
  assert.deepEqual(result.update, { payload: literal });
  assert.deepEqual(result.expectedDoc, { payload: literal });
});

test('planner treats cyclic non-plain Firestore values as opaque', () => {
  class FirestoreReferenceLike {
    constructor() {
      this.delegate = this;
    }
  }

  const reference = new FirestoreReferenceLike();
  const result = plan(
    { property: '/name', func: 'set', value: 'b' },
    { name: 'a', reference },
  );

  assert.equal(result.kind, 'targeted-write');
  assert.equal(
    result.expectedDoc.reference instanceof FirestoreReferenceLike,
    true,
  );
  assert.equal(
    result.expectedDoc.reference.delegate,
    result.expectedDoc.reference,
  );
});

test('inc returns an atomic transform whose expected document is already incremented', () => {
  const result = plan(
    { property: '/count', func: 'inc', value: { type: 'Integer', value: '2' } },
    { count: 1 },
  );
  assert.equal(result.kind, 'atomic-transform');
  assert.deepEqual(result.expectedDoc, { count: 3 });
});

test('same-value set preserves the server write intent', () => {
  const result = plan(
    { property: '/name', func: 'set', value: 'a' },
    { name: 'a' },
  );
  assert.equal(result.kind, 'targeted-write');
  assert.deepEqual(result.update, { name: 'a' });
  assert.deepEqual(result.expectedDoc, { name: 'a' });
});

test('same-value set through a matched selector preserves the rewrite intent', () => {
  const userDoc = { rows: [{ id: '1', v: 1 }] };
  const result = plan(
    { property: '/rows/@find:id|eq|1/v', func: 'set', value: 1 },
    userDoc,
  );

  assert.equal(result.kind, 'local-rewrite');
  assert.deepEqual(result.update, { rows: [{ id: '1', v: 1 }] });
  assert.deepEqual(result.expectedDoc, userDoc);
});

test('add of a cached array value preserves the server transform intent', () => {
  const result = plan(
    { property: '/tags', func: 'add', value: 'a' },
    { tags: ['a'] },
  );
  assert.equal(result.kind, 'atomic-transform');
  assert.deepEqual(result.expectedDoc, { tags: ['a'] });
});

test('delete of a locally missing field preserves the server transform intent', () => {
  const result = plan({ property: '/obsolete', func: 'del' }, {});
  assert.equal(result.kind, 'atomic-transform');
  assert.deepEqual(result.expectedDoc, {});
});

test('selector rewrite freezes the target from the local state', () => {
  const userDoc = { rows: [{ id: '1', v: 1 }, { id: '2', v: 2 }] };
  const result = plan(
    { property: '/rows/@find:id|eq|2/v', func: 'set', value: 9 },
    userDoc,
  );
  assert.equal(result.kind, 'local-rewrite');
  assert.deepEqual(result.expectedDoc.rows, [
    { id: '1', v: 1 },
    { id: '2', v: 9 },
  ]);
  // Input document is never mutated (planner purity).
  assert.deepEqual(userDoc.rows[1], { id: '2', v: 2 });
});
