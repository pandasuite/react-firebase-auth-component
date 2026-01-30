import assert from 'node:assert/strict';
import test from 'node:test';

import { JSONPointer, ModifyData } from '@beingenious/jsonpointer';

import * as modifyDataAdapter from '../src/hooks/useFirebaseWithBridge/modifyDataAdapter.mjs';

const FieldValue = {
  increment: (n) => ({ __op: 'increment', n }),
  delete: () => ({ __op: 'delete' }),
  arrayUnion: (...values) => ({ __op: 'arrayUnion', values }),
  arrayRemove: (...values) => ({ __op: 'arrayRemove', values }),
};

test('buildUserDocUpdate uses FieldValue.increment on simple paths', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = { count: 1 };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/count',
      func: 'inc',
      value: { type: 'Integer', value: '2' },
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, { count: { __op: 'increment', n: 2 } });
});

test('buildUserDocUpdate supports delbyid on arrays (atomic arrayRemove)', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: { property: '/items', func: 'delbyid', value: '2' },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, {
    items: { __op: 'arrayRemove', values: [{ id: '2', name: 'b' }] },
  });
});

test('buildUserDocUpdate sets inside arrays via @getById by rewriting the parent array', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      { id: '1', name: 'a' },
      { id: '2', name: 'b' },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: { property: '/items/@getById:2/name', func: 'set', value: 'B' },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.ok(Array.isArray(update.items));
  assert.equal(update.items[1].name, 'B');
});

test('buildUserDocUpdate sets inside arrays via @getByIndex by rewriting the parent array', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [{ name: 'a' }, { name: 'b' }],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: { property: '/items/@getByIndex:1/name', func: 'set', value: 'B' },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.ok(Array.isArray(update.items));
  assert.equal(update.items[1].name, 'B');
});

test('buildUserDocUpdate uses ModifyData for non-set operations inside arrays', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      { id: '1', tags: ['a'] },
      { id: '2', tags: ['b'] },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: { property: '/items/@getById:2/tags', func: 'add', value: 'c' },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.ok(Array.isArray(update.items));
  assert.deepEqual(update.items[1].tags, ['b', 'c']);
});

test('buildUserDocUpdate does not call JSONPointer.resolvePointer on the fast-path', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const JSONPointerFast = {
    getPointerByJSONPointer:
      JSONPointer.getPointerByJSONPointer.bind(JSONPointer),
    resolvePointer: () => {
      throw new Error('resolvePointer should not be called on simple paths');
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer: JSONPointerFast,
    ModifyData,
    userData: { count: 1 },
    modify: { property: '/count', func: 'inc', value: 1 },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, { count: { __op: 'increment', n: 1 } });
});

test('buildUserDocUpdate returns null when @getById target is not found', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [{ id: '1', name: 'a' }],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@getById:missing/name',
      func: 'set',
      value: 'x',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(update, null);
});

test('buildUserDocUpdate returns null when @getById base array is missing', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {},
    modify: { property: '/items/@getById:2/name', func: 'set', value: 'x' },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(update, null);
});
