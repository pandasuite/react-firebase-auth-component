import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  decodeIdKey,
  encodeIdKey,
  hydrateCollectionsForLogicalUse,
  normalizeCollection,
  normalizeCollectionsForStorage,
  toQueryableShape,
  toLogicalCollectionValue,
} from '../src/hooks/useFirebaseWithBridge/collectionStorageAdapter.mjs';

test('collectionStorageAdapter does not import Node buffer module (browser-safe)', () => {
  const source = fs.readFileSync(
    new URL(
      '../src/hooks/useFirebaseWithBridge/collectionStorageAdapter.mjs',
      import.meta.url,
    ),
    'utf8',
  );

  assert.equal(source.includes("from 'buffer'"), false);
});

test('encodeIdKey/decodeIdKey round-trips unsafe ids with k_ prefix', () => {
  const id = 'a.1/hello#world';
  const encoded = encodeIdKey(id);

  assert.equal(encoded.startsWith('k_'), true);
  assert.notEqual(encoded, id);
  assert.equal(decodeIdKey(encoded), id);
});

test('normalizeCollection migrates legacy Collection.value[] to order/valueById', () => {
  const normalized = normalizeCollection({
    type: 'Collection',
    schema: { path: { value: '/cards' } },
    value: [
      { id: 'a.1', name: 'A' },
      { id: 'b/2', name: 'B' },
    ],
  });

  assert.equal(normalized.type, 'Collection');
  assert.deepEqual(normalized.schema, { path: { value: '/cards' } });
  assert.deepEqual(normalized.order, ['a.1', 'b/2']);
  assert.deepEqual(normalized.valueById[encodeIdKey('a.1')], {
    id: 'a.1',
    name: 'A',
  });
  assert.deepEqual(normalized.valueById[encodeIdKey('b/2')], {
    id: 'b/2',
    name: 'B',
  });
});

test('toLogicalCollectionValue hydrates ordered list from canonical storage', () => {
  const collection = {
    type: 'Collection',
    schema: { path: { value: '/cards' } },
    order: ['b/2', 'a.1'],
    valueById: {
      [encodeIdKey('a.1')]: { id: 'a.1', name: 'A' },
      [encodeIdKey('b/2')]: { id: 'b/2', name: 'B' },
    },
  };

  assert.deepEqual(toLogicalCollectionValue(collection), [
    { id: 'b/2', name: 'B' },
    { id: 'a.1', name: 'A' },
  ]);
});

test('normalizeCollectionsForStorage canonicalizes nested Collection wrappers', () => {
  const input = {
    profile: {
      list: {
        type: 'Collection',
        value: [{ id: 'x.1', name: 'X' }],
      },
      refs: {
        type: 'References',
        schema: { path: { value: '/cards' } },
        value: [{ type: 'Reference', value: 'card-1' }],
      },
    },
  };

  const normalized = normalizeCollectionsForStorage(input);

  assert.deepEqual(normalized.profile.list.order, ['x.1']);
  assert.deepEqual(normalized.profile.list.valueById[encodeIdKey('x.1')], {
    id: 'x.1',
    name: 'X',
  });
  assert.equal(normalized.profile.list.value, undefined);
  assert.equal(
    Object.prototype.hasOwnProperty.call(normalized.profile.list, 'schema'),
    false,
  );
  assert.deepEqual(normalized.profile.refs, input.profile.refs);
  assert.deepEqual(input.profile.list.value, [{ id: 'x.1', name: 'X' }]);
});

test('hydrateCollectionsForLogicalUse injects value[] from canonical Collection recursively', () => {
  const input = {
    sections: [
      {
        items: {
          type: 'Collection',
          order: ['b', 'a'],
          valueById: {
            [encodeIdKey('a')]: { id: 'a', name: 'A' },
            [encodeIdKey('b')]: { id: 'b', name: 'B' },
          },
        },
      },
    ],
  };

  const hydrated = hydrateCollectionsForLogicalUse(input);

  assert.deepEqual(hydrated.sections[0].items.value, [
    { id: 'b', name: 'B' },
    { id: 'a', name: 'A' },
  ]);
  assert.deepEqual(hydrated.sections[0].items.order, ['b', 'a']);
  assert.deepEqual(hydrated.sections[0].items.valueById[encodeIdKey('a')], {
    id: 'a',
    name: 'A',
  });
});

test('normalizeCollectionsForStorage keeps non-plain objects intact', () => {
  const date = new Date('2026-02-24T00:00:00.000Z');
  const input = {
    createdAt: date,
    items: {
      type: 'Collection',
      value: [{ id: '1', createdAt: date }],
    },
  };

  const normalized = normalizeCollectionsForStorage(input);

  assert.equal(normalized.createdAt, date);
  assert.equal(normalized.items.valueById[encodeIdKey('1')].createdAt, date);
});

test('hydrateCollectionsForLogicalUse keeps non-plain objects intact', () => {
  const date = new Date('2026-02-24T00:00:00.000Z');
  const input = {
    createdAt: date,
    items: {
      type: 'Collection',
      order: ['1'],
      valueById: {
        [encodeIdKey('1')]: { id: '1', createdAt: date },
      },
    },
  };

  const hydrated = hydrateCollectionsForLogicalUse(input);

  assert.equal(hydrated.createdAt, date);
  assert.equal(hydrated.items.value[0].createdAt, date);
});

test('toQueryableShape projects canonical Collection to Panda shape only', () => {
  const input = {
    collection: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      order: ['b', 'a'],
      valueById: {
        [encodeIdKey('a')]: { id: 'a', name: 'A' },
        [encodeIdKey('b')]: { id: 'b', name: 'B' },
      },
    },
  };

  const queryable = toQueryableShape(input);

  assert.deepEqual(queryable.collection, {
    type: 'Collection',
    schema: { path: { value: '/cards' } },
    value: [
      { id: 'b', name: 'B' },
      { id: 'a', name: 'A' },
    ],
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(queryable.collection, 'order'),
    false,
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(queryable.collection, 'valueById'),
    false,
  );
});

test('toQueryableShape preserves legacy Panda Collection and non-plain objects', () => {
  const date = new Date('2026-02-24T00:00:00.000Z');
  const input = {
    createdAt: date,
    collection: {
      type: 'Collection',
      value: [{ id: '1', name: 'A', createdAt: date }],
    },
  };

  const queryable = toQueryableShape(input);

  assert.equal(queryable.createdAt, date);
  assert.deepEqual(queryable.collection, {
    type: 'Collection',
    value: [{ id: '1', name: 'A', createdAt: date }],
  });
});
