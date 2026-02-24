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

const encodeIdKey = (id) =>
  `k_${Buffer.from(String(id), 'utf8').toString('base64url')}`;

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

test('buildUserDocUpdate preserves decimal precision for inc', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = { count: 1 };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/count',
      func: 'inc',
      value: '0.25',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, { count: { __op: 'increment', n: 0.25 } });
});

test('buildUserDocUpdate preserves decimal precision for dec', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = { count: 1 };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/count',
      func: 'dec',
      value: '0.25',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, { count: { __op: 'increment', n: -0.25 } });
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

test('buildUserDocUpdate add on Collection wrapper migrates to canonical order/valueById', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      value: [{ id: '1', name: 'a' }],
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items',
      func: 'add',
      value: { id: '2', name: 'b' },
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.equal(update.items.type, 'Collection');
  assert.deepEqual(update.items.schema, { path: { value: '/cards' } });
  assert.deepEqual(update.items.order, ['1', '2']);
  assert.deepEqual(update.items.valueById[encodeIdKey('1')], {
    id: '1',
    name: 'a',
  });
  assert.deepEqual(update.items.valueById[encodeIdKey('2')], {
    id: '2',
    name: 'b',
  });
  assert.equal(update.items.value, undefined);
});

test('buildUserDocUpdate add on Collection wrapper without schema migrates to canonical storage', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    collection: {
      type: 'Collection',
      value: [],
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/collection',
      func: 'add',
      value: {
        id: '1234',
        name: 'Item 1234',
        color: { type: 'Color', value: 0 },
      },
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['collection']);
  assert.equal(update.collection.type, 'Collection');
  assert.deepEqual(update.collection.order, ['1234']);
  assert.deepEqual(update.collection.valueById[encodeIdKey('1234')], {
    id: '1234',
    name: 'Item 1234',
    color: { type: 'Color', value: 0 },
  });
  assert.equal(update.collection.value, undefined);
  assert.equal(
    Object.prototype.hasOwnProperty.call(update.collection, 'schema'),
    false,
  );
});

test('buildUserDocUpdate delbyid on Collection wrapper migrates to canonical order/valueById', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      value: [
        { id: '1', name: 'a' },
        { id: '2', name: 'b' },
      ],
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items',
      func: 'delbyid',
      value: '2',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.equal(update.items.type, 'Collection');
  assert.deepEqual(update.items.schema, { path: { value: '/cards' } });
  assert.deepEqual(update.items.order, ['1']);
  assert.deepEqual(update.items.valueById[encodeIdKey('1')], {
    id: '1',
    name: 'a',
  });
  assert.equal(update.items.value, undefined);
});

test('buildUserDocUpdate delbyvalue on Collection wrapper migrates to canonical order/valueById', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      value: [
        { id: '1', name: 'a' },
        { id: '2', name: 'b' },
      ],
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items',
      func: 'delbyvalue',
      value: { id: '2', name: 'b' },
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.equal(update.items.type, 'Collection');
  assert.deepEqual(update.items.schema, { path: { value: '/cards' } });
  assert.deepEqual(update.items.order, ['1']);
  assert.deepEqual(update.items.valueById[encodeIdKey('1')], {
    id: '1',
    name: 'a',
  });
  assert.equal(update.items.value, undefined);
});

test('buildUserDocUpdate add on canonical Collection wrapper preserves order/valueById', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      order: ['1'],
      valueById: {
        [encodeIdKey('1')]: { id: '1', name: 'a' },
      },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items',
      func: 'add',
      value: { id: '2', name: 'b' },
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update).sort(), [
    'items.order',
    `items.valueById.${encodeIdKey('2')}`,
  ]);
  assert.deepEqual(update['items.order'], ['1', '2']);
  assert.deepEqual(update[`items.valueById.${encodeIdKey('2')}`], {
    id: '2',
    name: 'b',
  });
});

test('buildUserDocUpdate add on canonical Collection with existing id falls back to rewrite', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      order: ['1', '2'],
      valueById: {
        [encodeIdKey('1')]: { id: '1', name: 'a' },
        [encodeIdKey('2')]: { id: '2', name: 'b', score: 1 },
      },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items',
      func: 'add',
      value: { id: '2', score: 2 },
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.equal(update.items.type, 'Collection');
  assert.deepEqual(update.items.schema, { path: { value: '/cards' } });
  assert.deepEqual(update.items.order, ['1', '2']);
  assert.deepEqual(update.items.valueById[encodeIdKey('1')], {
    id: '1',
    name: 'a',
  });
  assert.deepEqual(update.items.valueById[encodeIdKey('2')], {
    id: '2',
    name: 'b',
    score: 2,
  });
});

test('buildUserDocUpdate delbyid on canonical Collection wrapper preserves order/valueById', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      order: ['1', '2'],
      valueById: {
        [encodeIdKey('1')]: { id: '1', name: 'a' },
        [encodeIdKey('2')]: { id: '2', name: 'b' },
      },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items',
      func: 'delbyid',
      value: '2',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.equal(update.items.type, 'Collection');
  assert.deepEqual(update.items.schema, { path: { value: '/cards' } });
  assert.deepEqual(update.items.order, ['1']);
  assert.deepEqual(update.items.valueById[encodeIdKey('1')], {
    id: '1',
    name: 'a',
  });
  assert.equal(update.items.valueById[encodeIdKey('2')], undefined);
});

test('buildUserDocUpdate migrates legacy Collection @getById set to canonical storage', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const id = 'a.1';
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      value: [{ id, name: 'A' }],
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: `/items/@getById:${id}/name`,
      func: 'set',
      value: 'B',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.equal(update.items.type, 'Collection');
  assert.deepEqual(update.items.schema, { path: { value: '/cards' } });
  assert.deepEqual(update.items.order, [id]);
  assert.deepEqual(update.items.valueById[encodeIdKey(id)], { id, name: 'B' });
});

test('buildUserDocUpdate writes deterministic Collection @find:id|eq to valueById.<encoded>.name', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const id = 'a.1';
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      order: [id],
      valueById: {
        [encodeIdKey(id)]: { id, name: 'A' },
      },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: `/items/@find:id|eq|${id}/name`,
      func: 'set',
      value: 'B',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, {
    [`items.valueById.${encodeIdKey(id)}.name`]: 'B',
  });
});

test('buildUserDocUpdate aligns @getById coercion with runtime when targeting Collection', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      value: [
        { id: 2, name: 'N2' },
        { id: '02', name: 'N02' },
      ],
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@getById:02/name',
      func: 'set',
      value: 'X',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.deepEqual(update.items.order, ['2', '02']);
  assert.deepEqual(update.items.valueById[encodeIdKey('2')], {
    id: '2',
    name: 'X',
  });
  assert.deepEqual(update.items.valueById[encodeIdKey('02')], {
    id: '02',
    name: 'N02',
  });
});

test('buildUserDocUpdate aligns @minBy runtime winner when targeting Collection', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      order: ['a', 'b'],
      valueById: {
        [encodeIdKey('a')]: { id: 'a', score: null, name: 'A' },
        [encodeIdKey('b')]: { id: 'b', score: 0, name: 'B' },
      },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@minBy:score/name',
      func: 'set',
      value: 'WIN',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, {
    [`items.valueById.${encodeIdKey('b')}.name`]: 'WIN',
  });
});

test('buildUserDocUpdate uses runtime language when targeting locale-driven @minBy', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      order: ['a', 'b'],
      valueById: {
        [encodeIdKey('a')]: {
          id: 'a',
          name: 'z',
          locale_name: { type: 'Language', value: { en_US: 'z', fr_FR: 'a' } },
        },
        [encodeIdKey('b')]: {
          id: 'b',
          name: 'a',
          locale_name: { type: 'Language', value: { en_US: 'a', fr_FR: 'z' } },
        },
      },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@minBy:name/name',
      func: 'set',
      value: 'WIN',
    },
    FieldValue,
    language: 'fr_FR',
  });

  assert.deepEqual(update, {
    [`items.valueById.${encodeIdKey('a')}.name`]: 'WIN',
  });
});

test('buildUserDocUpdate duplicate ids fallback does not produce targeted valueById path', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: {
      type: 'Collection',
      schema: { path: { value: '/cards' } },
      value: [
        { id: 'dup', name: 'A1' },
        { id: 'dup', name: 'A2' },
      ],
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@getById:dup/name',
      func: 'set',
      value: 'Z',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.notEqual(update, null);
  const keys = Object.keys(update);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].includes('valueById'), false);
});

test('buildUserDocUpdate preserves References duplicates/order semantics across add/del flow', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const ref1 = { type: 'Reference', value: 'card1' };
  const ref2 = { type: 'Reference', value: 'card2' };
  const userData = {
    refs: {
      type: 'References',
      schema: { path: { value: '/cards' } },
      value: [ref1, ref1],
    },
  };

  const afterAdd = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/refs',
      func: 'add',
      value: ref2,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(afterAdd, {
    refs: {
      type: 'References',
      schema: { path: { value: '/cards' } },
      value: [ref1, ref1, ref2],
    },
  });
  assert.equal(afterAdd.refs.order, undefined);
  assert.equal(afterAdd.refs.valueById, undefined);

  const afterDel = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { refs: afterAdd.refs },
    modify: {
      property: '/refs',
      func: 'delbyvalue',
      value: ref1,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(afterDel, {
    refs: {
      type: 'References',
      schema: { path: { value: '/cards' } },
      value: [ref2],
    },
  });
  assert.equal(afterDel.refs.order, undefined);
  assert.equal(afterDel.refs.valueById, undefined);
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
  assert.deepEqual(update.items, [
    { id: '1', name: 'a' },
    { id: '2', name: 'B' },
  ]);
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
  assert.deepEqual(update.items, [{ name: 'a' }, { name: 'B' }]);
});

test('buildUserDocUpdate does not mutate source array when building index-path update payload', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [{ name: 'a' }, { name: 'b' }],
  };
  const before = structuredClone(userData);

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: { property: '/items/@getByIndex:1/name', func: 'set', value: 'B' },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update.items, [{ name: 'a' }, { name: 'B' }]);
  assert.deepEqual(userData, before);
});

test('buildUserDocUpdate sets via @find by rewriting parent array', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@find:id|eq|2/name',
      func: 'set',
      value: 'B',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.deepEqual(update.items, [
    { id: 1, name: 'a' },
    { id: 2, name: 'B' },
  ]);
});

test('buildUserDocUpdate preserves non-plain objects during @find rewrite', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const createdAt = new Date('2026-02-24T00:00:00.000Z');
  const userData = {
    items: [
      { id: 1, name: 'a', createdAt },
      { id: 2, name: 'b', createdAt },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@find:id|eq|2/name',
      func: 'set',
      value: 'B',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.equal(update.items[0].createdAt instanceof Date, true);
  assert.equal(update.items[1].createdAt instanceof Date, true);
  assert.equal(update.items[0].createdAt.getTime(), createdAt.getTime());
  assert.equal(update.items[1].createdAt.getTime(), createdAt.getTime());
});

test('buildUserDocUpdate mixed selector chain rewrites stable parent array', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      {
        id: '1',
        sub: [
          { id: 'a', name: 'AA' },
          { id: 'b', name: 'BB' },
        ],
      },
      {
        id: '2',
        sub: [
          { id: 'c', name: 'CC' },
          { id: 'd', name: 'DD-old' },
        ],
      },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@getById:2/sub/@find:id|eq|d/name',
      func: 'set',
      value: 'DD',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.deepEqual(update.items, [
    {
      id: '1',
      sub: [
        { id: 'a', name: 'AA' },
        { id: 'b', name: 'BB' },
      ],
    },
    {
      id: '2',
      sub: [
        { id: 'c', name: 'CC' },
        { id: 'd', name: 'DD' },
      ],
    },
  ]);
});

test('buildUserDocUpdate nested rewrite keeps canonical Collection shape and updates valueById', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    sections: [
      {
        id: 's1',
        items: {
          type: 'Collection',
          schema: { path: { value: '/cards' } },
          order: ['a', 'b'],
          valueById: {
            [encodeIdKey('a')]: { id: 'a', name: 'A' },
            [encodeIdKey('b')]: { id: 'b', name: 'B' },
          },
        },
      },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/sections/@find:id|eq|s1/items/@find:id|eq|b/name',
      func: 'set',
      value: 'BB',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['sections']);
  assert.ok(Array.isArray(update.sections));
  assert.equal(update.sections.length, 1);
  assert.equal(update.sections[0].id, 's1');
  assert.deepEqual(update.sections[0].items.order, ['a', 'b']);
  assert.deepEqual(update.sections[0].items.valueById[encodeIdKey('a')], {
    id: 'a',
    name: 'A',
  });
  assert.deepEqual(update.sections[0].items.valueById[encodeIdKey('b')], {
    id: 'b',
    name: 'BB',
  });
  assert.equal(update.sections[0].items.value, undefined);
});

test('buildUserDocUpdate sets via @minBy by rewriting parent array', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      { id: 1, score: 20, name: 'a' },
      { id: 2, score: 5, name: 'b' },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@minBy:score/name',
      func: 'set',
      value: 'MIN',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.ok(Array.isArray(update.items));
  assert.equal(update.items.length, 2);
  assert.deepEqual(update.items[0], { id: 1, score: 20, name: 'a' });
  assert.deepEqual(update.items[1], { id: 2, score: 5, name: 'MIN' });
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

test('buildUserDocUpdate adds via @find by rewriting parent array', () => {
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
    modify: {
      property: '/items/@find:id|eq|2/tags',
      func: 'add',
      value: 'x',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.ok(Array.isArray(update.items));
  assert.deepEqual(update.items[1].tags, ['b', 'x']);
  assert.deepEqual(update.items[0], { id: '1', tags: ['a'] });
});

test('buildUserDocUpdate returns null for @find no-match (silent no-op)', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [{ id: 1, name: 'a' }],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@find:id|eq|404/name',
      func: 'set',
      value: 'X',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(update, null);
});

test('buildUserDocUpdate returns null for @findIndex chained set (silent no-op)', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ],
  };
  const before = structuredClone(userData);

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@findIndex:id|eq|2/name',
      func: 'set',
      value: 'X',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(update, null);
  assert.deepEqual(userData, before);
});

test('buildUserDocUpdate returns null for @findLastIndex chained set (silent no-op)', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ],
  };
  const before = structuredClone(userData);

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@findLastIndex:id|eq|2/name',
      func: 'set',
      value: 'X',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(update, null);
  assert.deepEqual(userData, before);
});

test('buildUserDocUpdate uses JSONPointer computed selector helper', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const JSONPointerWithComputedSelector = {
    getPointerByJSONPointer:
      JSONPointer.getPointerByJSONPointer.bind(JSONPointer),
    isFunctionTypeComputedSelector: (funcName) => funcName === 'customSelector',
  };
  const userData = {
    items: [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ],
  };
  const before = structuredClone(userData);

  const update = buildUserDocUpdate({
    JSONPointer: JSONPointerWithComputedSelector,
    ModifyData,
    userData,
    modify: {
      property: '/items/@customSelector:id|eq|2/name',
      func: 'set',
      value: 'X',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(update, null);
  assert.deepEqual(userData, before);
});

test('buildUserDocUpdate preserves legacy @count path behavior', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@count:',
      func: 'set',
      value: 99,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, { items: 99 });
});

test('buildUserDocUpdate preserves legacy @add path behavior with set', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = { count: 1 };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/count/@add:1',
      func: 'set',
      value: 42,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, { count: 42 });
});

test('buildUserDocUpdate preserves legacy @pluck path behavior', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@pluck:name',
      func: 'set',
      value: [],
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, { items: [] });
});

test('buildUserDocUpdate does not call JSONPointer.resolvePointer on the fast-path', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const JSONPointerFast = {
    getPointerByJSONPointer:
      JSONPointer.getPointerByJSONPointer.bind(JSONPointer),
    isFunctionTypeComputedSelector: () => false,
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
