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

const buildCanonicalRowUpdate = ({ row, modify }) => {
  const rowKey = encodeIdKey('1');
  const result = modifyDataAdapter.buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      items: {
        type: 'Collection',
        order: ['1'],
        valueById: { [rowKey]: { id: '1', ...row } },
      },
    },
    modify,
    FieldValue,
    language: 'en_US',
  });
  return { result, rowKey };
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

test('buildUserDocUpdate keeps @getByKey segment for nested inc updates', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    Points: {
      'Wed, 3-04-26': {
        Times_accomplished_each_discipline: {
          Meditation: 2,
        },
      },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property:
        '/Points/@getByKey:Wed, 3-04-26/Times_accomplished_each_discipline/Meditation',
      func: 'inc',
      value: 1,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, {
    'Points.Wed, 3-04-26.Times_accomplished_each_discipline.Meditation': {
      __op: 'increment',
      n: 1,
    },
  });
});

test('buildUserDocUpdate keeps numeric @getByKey values as map keys', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    Buckets: {
      0: {
        score: 1,
      },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/Buckets/@getByKey:0/score',
      func: 'inc',
      value: 2,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, {
    'Buckets.0.score': {
      __op: 'increment',
      n: 2,
    },
  });
});

test('buildUserDocUpdate emits a structured field path for nested dotted keys', () => {
  const { buildUserDocUpdate, FIELD_PATH_UPDATES } = modifyDataAdapter;
  const userData = {
    Points: {
      'Thu.03': { score: 1 },
      Safe: { score: 9 },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/Points/@getByKey:Thu.03/score',
      func: 'inc',
      value: 1,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), []);
  assert.deepEqual(update[FIELD_PATH_UPDATES], [
    {
      segments: ['Points', 'Thu.03', 'score'],
      value: { __op: 'increment', n: 1 },
    },
  ]);
});

test('buildUserDocUpdate emits a structured field path for root dotted keys', () => {
  const { buildUserDocUpdate, FIELD_PATH_UPDATES } = modifyDataAdapter;
  const userData = {
    'Thu.03': { score: 1 },
    Safe: { score: 9 },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/@getByKey:Thu.03/score',
      func: 'inc',
      value: 1,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), []);
  assert.deepEqual(update[FIELD_PATH_UPDATES], [
    {
      segments: ['Thu.03', 'score'],
      value: { __op: 'increment', n: 1 },
    },
  ]);
});

test('buildUserDocUpdate does not collide replacement sentinel with user field names', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {};

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/__replaceDocument',
      func: 'set',
      value: { ok: true },
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(update, {
    __replaceDocument: { ok: true },
  });
});

test('buildUserDocUpdate scopes non-set @getByKey array updates to the keyed branch', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    Points: {
      d1: {
        items: [
          { id: '1', tags: ['a'] },
          { id: '2', tags: ['b'] },
        ],
      },
      d2: {
        items: [{ id: '9', tags: ['z'] }],
      },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/Points/@getByKey:d1/items/@getById:2/tags',
      func: 'add',
      value: 'c',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['Points.d1.items']);
  assert.deepEqual(update['Points.d1.items'], [
    { id: '1', tags: ['a'] },
    { id: '2', tags: ['b', 'c'] },
  ]);
});

test('buildUserDocUpdate emits a structured field path for dotted keyed array rewrites', () => {
  const { buildUserDocUpdate, FIELD_PATH_UPDATES } = modifyDataAdapter;
  const userData = {
    Points: {
      'Thu.03': {
        items: [
          { id: '1', tags: ['a'] },
          { id: '2', tags: ['b'] },
        ],
      },
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/Points/@getByKey:Thu.03/items/@getById:2/tags',
      func: 'add',
      value: 'c',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), []);
  assert.deepEqual(update[FIELD_PATH_UPDATES], [
    {
      segments: ['Points', 'Thu.03', 'items'],
      value: [
        { id: '1', tags: ['a'] },
        { id: '2', tags: ['b', 'c'] },
      ],
    },
  ]);
});

test('buildUserDocUpdate rewrites arrays beneath dotted keys before submitting', () => {
  const { buildUserDocUpdate, FIELD_PATH_UPDATES } = modifyDataAdapter;
  const userData = {
    'Thu.03': {
      items: [{ name: 'a' }, { name: 'b' }],
    },
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/@getByKey:Thu.03/items/@getByIndex:1/name',
      func: 'set',
      value: 'B',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), []);
  assert.deepEqual(update[FIELD_PATH_UPDATES], [
    {
      segments: ['Thu.03', 'items'],
      value: [{ name: 'a' }, { name: 'B' }],
    },
  ]);
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

test('buildUserDocUpdate add on canonical Collection uses atomic membership', () => {
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
  assert.deepEqual(update['items.order'], {
    __op: 'arrayUnion',
    values: ['2'],
  });
  assert.deepEqual(update[`items.valueById.${encodeIdKey('2')}`], {
    id: '2',
    name: 'b',
  });
});

test('buildUserDocUpdate add on canonical Collection with existing id merges one row', () => {
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

  assert.deepEqual(Object.keys(update).sort(), [
    'items.order',
    `items.valueById.${encodeIdKey('2')}`,
  ]);
  assert.deepEqual(update['items.order'], {
    __op: 'arrayUnion',
    values: ['2'],
  });
  assert.deepEqual(update[`items.valueById.${encodeIdKey('2')}`], {
    id: '2',
    name: 'b',
    score: 2,
  });
});

test('buildUserDocUpdate delbyid on canonical Collection uses atomic membership and row delete', () => {
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

  assert.deepEqual(Object.keys(update).sort(), [
    'items.order',
    `items.valueById.${encodeIdKey('2')}`,
  ]);
  assert.deepEqual(update['items.order'], {
    __op: 'arrayRemove',
    values: ['2'],
  });
  assert.deepEqual(update[`items.valueById.${encodeIdKey('2')}`], {
    __op: 'delete',
  });
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

test('buildUserDocUpdate preserves dotted keys when setting inside arrays via @getById', () => {
  const { buildUserDocUpdate } = modifyDataAdapter;
  const userData = {
    items: [
      { id: '1', 'a.b': 1 },
      { id: '2', 'a.b': 2 },
    ],
  };

  const update = buildUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: { property: '/items/@getById:2/a.b', func: 'set', value: 99 },
    FieldValue,
    language: 'en_US',
  });

  assert.deepEqual(Object.keys(update), ['items']);
  assert.deepEqual(update.items, [
    { id: '1', 'a.b': 1 },
    { id: '2', 'a.b': 99 },
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

test('buildClassifiedUserDocUpdate emits FIELD_PATH_UPDATES for dotted literal keys', () => {
  const { buildClassifiedUserDocUpdate, FIELD_PATH_UPDATES } = modifyDataAdapter;
  const userData = { profile: { 'a.b': 1, keep: true } };

  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: [
        { func: 'getKey', value: 'profile' },
        { func: 'getKey', value: 'a.b' },
      ],
      func: 'set',
      value: 2,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'targeted-write');
  assert.deepEqual(result.update[FIELD_PATH_UPDATES], [
    { segments: ['profile', 'a.b'], value: 2 },
  ]);
  // No parent clone: the dotted key must not force a rewrite of `profile`.
  assert.equal(Object.keys(result.update).length, 0);
});

test('buildClassifiedUserDocUpdate uses structured paths for every Firestore path metacharacter', () => {
  const { buildClassifiedUserDocUpdate, FIELD_PATH_UPDATES } = modifyDataAdapter;

  for (const key of ['a~b', 'a*b', 'a/b', 'a[b', 'a]b']) {
    const result = buildClassifiedUserDocUpdate({
      JSONPointer,
      ModifyData,
      userData: { profile: { [key]: 1 } },
      modify: {
        property: [
          { func: 'getKey', value: 'profile' },
          { func: 'getKey', value: key },
        ],
        func: 'set',
        value: 2,
      },
      FieldValue,
      language: 'en_US',
    });

    assert.equal(result.category, 'targeted-write');
    assert.deepEqual(result.update[FIELD_PATH_UPDATES], [
      { segments: ['profile', key], value: 2 },
    ]);
    assert.deepEqual(Object.keys(result.update), []);
  }
});

test('buildClassifiedUserDocUpdate classifies transforms, targeted writes and rewrites', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;

  const inc = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { count: 1 },
    modify: { property: '/count', func: 'inc', value: 1 },
    FieldValue,
    language: 'en_US',
  });
  assert.equal(inc.category, 'atomic-transform');

  const set = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { name: 'a' },
    modify: { property: '/name', func: 'set', value: 'b' },
    FieldValue,
    language: 'en_US',
  });
  assert.equal(set.category, 'targeted-write');
  assert.deepEqual(set.update, { name: 'b' });

  const rewrite = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { rows: [{ id: '1', v: 1 }, { id: '2', v: 2 }] },
    modify: {
      property: '/rows/@find:id|eq|2/v',
      func: 'set',
      value: 9,
    },
    FieldValue,
    language: 'en_US',
  });
  assert.equal(rewrite.category, 'local-rewrite');
});

test('canonical Collection selector transforms target valueById atomically', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const rowKey = encodeIdKey('1');
  const userData = {
    items: {
      type: 'Collection',
      order: ['1'],
      valueById: {
        [rowKey]: { id: '1', count: 0, tags: ['a'], obsolete: true },
      },
    },
  };
  const cases = [
    {
      modify: {
        property: '/items/@getById:1/count',
        func: 'inc',
        value: 2,
      },
      field: 'count',
      value: { __op: 'increment', n: 2 },
    },
    {
      modify: {
        property: '/items/@find:id|eq|1/obsolete',
        func: 'del',
      },
      field: 'obsolete',
      value: { __op: 'delete' },
    },
  ];

  for (const entry of cases) {
    const result = buildClassifiedUserDocUpdate({
      JSONPointer,
      ModifyData,
      userData,
      modify: entry.modify,
      FieldValue,
      language: 'en_US',
    });

    assert.equal(result.category, 'atomic-transform', entry.modify.property);
    assert.deepEqual(result.update, {
      [`items.valueById.${rowKey}.${entry.field}`]: entry.value,
    });
  }
});

test('add below a canonical Collection selector keeps ID-upsert semantics via local rewrite', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const rowKey = encodeIdKey('1');
  const userData = {
    items: {
      type: 'Collection',
      order: ['1'],
      valueById: {
        [rowKey]: { id: '1', children: [{ id: 'child', name: 'old' }] },
      },
    },
  };

  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData,
    modify: {
      property: '/items/@getById:1/children',
      func: 'add',
      value: { id: 'child', extra: 1 },
    },
    FieldValue,
    language: 'en_US',
  });

  // arrayUnion would append a second { id: 'child' } row; ModifyData's add
  // merges into the existing same-ID row, so this must stay a local rewrite.
  assert.equal(result.category, 'local-rewrite');
  assert.deepEqual(result.update.items.valueById[rowKey].children, [
    { id: 'child', name: 'old', extra: 1 },
  ]);
});

test('inc below a canonical selector falls back to ModifyData when the value is a wrapper', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const rowKey = encodeIdKey('1');

  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      items: {
        type: 'Collection',
        order: ['1'],
        valueById: {
          [rowKey]: { id: '1', score: { type: 'Number', value: 5 } },
        },
      },
    },
    modify: { property: '/items/@getById:1/score', func: 'inc', value: 2 },
    FieldValue,
    language: 'en_US',
  });

  // A Firestore increment on the stored map would clobber it with the
  // operand (2); ModifyData must produce the incremented result instead.
  assert.equal(result.category, 'local-rewrite');
  assert.equal(result.update.items.valueById[rowKey].score, 7);
});

test('inc below a canonical selector rewrites non-finite stored numbers', () => {
  for (const score of [NaN, Infinity]) {
    const { result, rowKey } = buildCanonicalRowUpdate({
      row: { score },
      modify: { property: '/items/@getById:1/score', func: 'inc', value: 2 },
    });

    assert.equal(result.category, 'local-rewrite');
    assert.equal(result.update.items.valueById[rowKey].score, 2);
  }
});

test('inc below a canonical selector preserves parseFloat operand semantics', () => {
  const { result, rowKey } = buildCanonicalRowUpdate({
    row: { score: 1 },
    modify: { property: '/items/@getById:1/score', func: 'inc', value: '2px' },
  });

  assert.equal(result.category, 'local-rewrite');
  assert.equal(result.update.items.valueById[rowKey].score, 3);
});

test('del of a whole canonical row updates membership, not just valueById', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const rowKey = encodeIdKey('1');

  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      items: {
        type: 'Collection',
        order: ['1', '2'],
        valueById: {
          [rowKey]: { id: '1', v: 1 },
          [encodeIdKey('2')]: { id: '2', v: 2 },
        },
      },
    },
    modify: { property: '/items/@getById:1', func: 'del' },
    FieldValue,
    language: 'en_US',
  });

  // Deleting only the valueById entry would leave a dangling '1' in order.
  assert.equal(result.category, 'atomic-transform');
  assert.deepEqual(result.update, {
    'items.order': { __op: 'arrayRemove', values: ['1'] },
    [`items.valueById.${rowKey}`]: { __op: 'delete' },
  });
});

test('del below a canonical selector preserves typed field wrappers', () => {
  const { result, rowKey } = buildCanonicalRowUpdate({
    row: { title: { type: 'Text', value: 'hello' } },
    modify: { property: '/items/@getById:1/title', func: 'del' },
  });

  assert.equal(result.category, 'local-rewrite');
  assert.deepEqual(result.update.items.valueById[rowKey].title, {
    type: 'Text',
    value: null,
  });
});

test('delbyid below a canonical selector ignores non-array targets', () => {
  const { result } = buildCanonicalRowUpdate({
    row: { map: { entry: { id: 'x' } } },
    modify: { property: '/items/@getById:1/map', func: 'delbyid', value: 'x' },
  });

  assert.equal(result, null);
});

test('delbyid below a canonical selector rewrites loose ID matches', () => {
  const { result, rowKey } = buildCanonicalRowUpdate({
    row: { rows: [{ id: 2 }, { id: '2' }, { id: 'keep' }] },
    modify: { property: '/items/@getById:1/rows', func: 'delbyid', value: '2' },
  });

  assert.equal(result.category, 'local-rewrite');
  assert.deepEqual(result.update.items.valueById[rowKey].rows, [
    { id: 'keep' },
  ]);
});

test('delbyvalue below a canonical selector requires an actual array target', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const rowKey = encodeIdKey('1');

  // Firestore arrayRemove would replace the stored map with []; ModifyData
  // treats delbyvalue on a non-array as a no-op, so the plan must be null.
  const onMap = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      items: {
        type: 'Collection',
        order: ['1'],
        valueById: { [rowKey]: { id: '1', map: { keep: true } } },
      },
    },
    modify: { property: '/items/@getById:1/map', func: 'delbyvalue', value: 'x' },
    FieldValue,
    language: 'en_US',
  });
  assert.equal(onMap, null);

  // A real array keeps the atomic fast path.
  const onArray = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      items: {
        type: 'Collection',
        order: ['1'],
        valueById: { [rowKey]: { id: '1', tags: ['a', 'b'] } },
      },
    },
    modify: { property: '/items/@getById:1/tags', func: 'delbyvalue', value: 'a' },
    FieldValue,
    language: 'en_US',
  });
  assert.equal(onArray.category, 'atomic-transform');
  assert.deepEqual(onArray.update, {
    [`items.valueById.${rowKey}.tags`]: { __op: 'arrayRemove', values: ['a'] },
  });
});

test('delbyvalue below a canonical selector rewrites wrapped array values', () => {
  const { result, rowKey } = buildCanonicalRowUpdate({
    row: { tags: [{ type: 'Text', value: 'x' }] },
    modify: {
      property: '/items/@getById:1/tags',
      func: 'delbyvalue',
      value: 'x',
    },
  });

  assert.equal(result.category, 'local-rewrite');
  assert.deepEqual(result.update.items.valueById[rowKey].tags, []);
});

test('membership transforms target the exact stored order value for unnormalized IDs', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const rowKey = encodeIdKey('1');

  // Upsert over a numerically-stored ID: arrayUnion('1') would produce
  // [1, '1']; the transform must reuse the stored numeric value.
  const upsert = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      items: { type: 'Collection', order: [1], valueById: { [rowKey]: { id: '1', v: 1 } } },
    },
    modify: { property: '/items', func: 'add', value: { id: '1', v: 5 } },
    FieldValue,
    language: 'en_US',
  });
  assert.deepEqual(upsert.update['items.order'], {
    __op: 'arrayUnion',
    values: [1],
  });

  // Same for removal: arrayRemove('2') would leave the numeric 2 behind.
  const removal = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      items: {
        type: 'Collection',
        order: [1, 2],
        valueById: {
          [rowKey]: { id: '1', v: 1 },
          [encodeIdKey('2')]: { id: '2', v: 2 },
        },
      },
    },
    modify: { property: '/items', func: 'delbyid', value: '2' },
    FieldValue,
    language: 'en_US',
  });
  assert.deepEqual(removal.update['items.order'], {
    __op: 'arrayRemove',
    values: [2],
  });
});

test('canonical Collection add uses arrayUnion membership plus one row write', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const collection = {
    type: 'Collection',
    order: ['1'],
    valueById: { [encodeIdKey('1')]: { id: '1', v: 1 } },
  };

  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { items: collection },
    modify: {
      property: '/items',
      func: 'add',
      value: { id: '2', v: 2 },
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'atomic-transform');
  assert.deepEqual(result.update, {
    'items.order': { __op: 'arrayUnion', values: ['2'] },
    [`items.valueById.${encodeIdKey('2')}`]: { id: '2', v: 2 },
  });
});

test('canonical Collection add of an existing ID stays a membership no-op plus row merge', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const collection = {
    type: 'Collection',
    order: ['1'],
    valueById: { [encodeIdKey('1')]: { id: '1', v: 1 } },
  };

  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { items: collection },
    modify: {
      property: '/items',
      func: 'add',
      value: { id: '1', v: 5 },
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'atomic-transform');
  assert.equal(
    result.update['items.order'].__op,
    'arrayUnion',
    'membership must stay an arrayUnion no-op, never a literal order rewrite',
  );
  assert.deepEqual(
    result.update[`items.valueById.${encodeIdKey('1')}`],
    { id: '1', v: 5 },
  );
});

test('canonical Collection add of an identical existing row stays atomic', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const row = { id: '1', v: 1 };
  const collection = {
    type: 'Collection',
    order: ['1'],
    valueById: { [encodeIdKey('1')]: row },
  };

  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { items: collection },
    modify: { property: '/items', func: 'add', value: row },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'atomic-transform');
  assert.deepEqual(result.update, {
    'items.order': { __op: 'arrayUnion', values: ['1'] },
    [`items.valueById.${encodeIdKey('1')}`]: row,
  });
});

test('canonical Collection delbyid uses arrayRemove membership plus row delete', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const collection = {
    type: 'Collection',
    order: ['1', '2'],
    valueById: {
      [encodeIdKey('1')]: { id: '1', v: 1 },
      [encodeIdKey('2')]: { id: '2', v: 2 },
    },
  };

  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { items: collection },
    modify: { property: '/items', func: 'delbyid', value: '2' },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'atomic-transform');
  assert.deepEqual(result.update, {
    'items.order': { __op: 'arrayRemove', values: ['2'] },
    [`items.valueById.${encodeIdKey('2')}`]: { __op: 'delete' },
  });
});

test('canonical delete paths remove rows stored under legacy raw keys', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const row = { id: 'foo', v: 1 };
  const modifications = [
    { property: '/items', func: 'delbyid', value: 'foo' },
    { property: '/items', func: 'delbyvalue', value: row },
    { property: '/items/@getById:foo', func: 'del' },
  ];

  for (const modify of modifications) {
    const result = buildClassifiedUserDocUpdate({
      JSONPointer,
      ModifyData,
      userData: {
        items: {
          type: 'Collection',
          order: ['foo'],
          valueById: { foo: row },
        },
      },
      modify,
      FieldValue,
      language: 'en_US',
    });

    assert.equal(result.category, 'atomic-transform', modify.func);
    assert.deepEqual(result.update, {
      'items.order': { __op: 'arrayRemove', values: ['foo'] },
      'items.valueById.foo': { __op: 'delete' },
    });
  }
});

test('canonical Collection delbyid removes equivalent memberships when the row is absent locally', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      items: { type: 'Collection', order: [], valueById: {} },
    },
    modify: { property: '/items', func: 'delbyid', value: '1' },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'atomic-transform');
  assert.deepEqual(result.update, {
    'items.order': { __op: 'arrayRemove', values: ['1', 1] },
    [`items.valueById.${encodeIdKey('1')}`]: { __op: 'delete' },
  });
});

test('inc and dec of a missing canonical row field stay atomic', () => {
  for (const [func, operand] of [
    ['inc', 2],
    ['dec', -2],
  ]) {
    const { result, rowKey } = buildCanonicalRowUpdate({
      row: { untouched: true },
      modify: {
        property: '/items/@getById:1/score',
        func,
        value: 2,
      },
    });

    assert.equal(result.category, 'atomic-transform', func);
    assert.deepEqual(result.update, {
      [`items.valueById.${rowKey}.score`]: {
        __op: 'increment',
        n: operand,
      },
    });
  }
});

test('plain-array delbyid keeps exact-row arrayRemove', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { rows: [{ id: '1', v: 1 }] },
    modify: { property: '/rows', func: 'delbyid', value: '1' },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'atomic-transform');
  assert.deepEqual(result.update, {
    rows: { __op: 'arrayRemove', values: [{ id: '1', v: 1 }] },
  });
});

test('parsePointerObjects returns [] for an unparseable property', () => {
  const { parsePointerObjects } = modifyDataAdapter;
  assert.deepEqual(
    parsePointerObjects({ JSONPointer, property: 42 }),
    [],
  );
});

test('buildClassifiedUserDocUpdate classifies @getById array set as a local rewrite', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { rows: [{ id: '1', v: 1 }, { id: '2', v: 2 }] },
    modify: {
      property: '/rows/@getById:2/v',
      func: 'set',
      value: 9,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'local-rewrite');
  assert.deepEqual(result.update, {
    rows: [{ id: '1', v: 1 }, { id: '2', v: 9 }],
  });
});

test('buildClassifiedUserDocUpdate classifies @getByIndex array set as a local rewrite', () => {
  const { buildClassifiedUserDocUpdate } = modifyDataAdapter;
  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: { rows: [{ v: 1 }, { v: 2 }] },
    modify: {
      property: '/rows/@getByIndex:1/v',
      func: 'set',
      value: 9,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'local-rewrite');
  assert.deepEqual(result.update, {
    rows: [{ v: 1 }, { v: 9 }],
  });
});

test('canonical Collection targeted set beneath a dotted literal key uses FIELD_PATH_UPDATES', () => {
  const { buildClassifiedUserDocUpdate, FIELD_PATH_UPDATES } = modifyDataAdapter;
  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      'a.b': {
        type: 'Collection',
        order: ['1'],
        valueById: { [encodeIdKey('1')]: { id: '1', v: 1 } },
      },
    },
    modify: {
      property: [
        { func: 'getKey', value: 'a.b' },
        { func: 'getById', value: '1' },
        { func: 'getKey', value: 'v' },
      ],
      func: 'set',
      value: 9,
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'targeted-write');
  assert.deepEqual(Object.keys(result.update), []);
  assert.deepEqual(result.update[FIELD_PATH_UPDATES], [
    {
      segments: ['a.b', 'valueById', encodeIdKey('1'), 'v'],
      value: 9,
    },
  ]);
});

test('canonical Collection add beneath a dotted literal key uses FIELD_PATH_UPDATES', () => {
  const { buildClassifiedUserDocUpdate, FIELD_PATH_UPDATES } = modifyDataAdapter;
  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      'a.b': {
        type: 'Collection',
        order: ['1'],
        valueById: { [encodeIdKey('1')]: { id: '1', v: 1 } },
      },
    },
    modify: {
      property: [{ func: 'getKey', value: 'a.b' }],
      func: 'add',
      value: { id: '2', v: 2 },
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'atomic-transform');
  assert.deepEqual(Object.keys(result.update), []);
  assert.deepEqual(result.update[FIELD_PATH_UPDATES], [
    {
      segments: ['a.b', 'order'],
      value: { __op: 'arrayUnion', values: ['2'] },
    },
    {
      segments: ['a.b', 'valueById', encodeIdKey('2')],
      value: { id: '2', v: 2 },
    },
  ]);
});

test('canonical Collection delete beneath a dotted literal key uses FIELD_PATH_UPDATES', () => {
  const { buildClassifiedUserDocUpdate, FIELD_PATH_UPDATES } = modifyDataAdapter;
  const result = buildClassifiedUserDocUpdate({
    JSONPointer,
    ModifyData,
    userData: {
      'a.b': {
        type: 'Collection',
        order: ['1', '2'],
        valueById: {
          [encodeIdKey('1')]: { id: '1', v: 1 },
          [encodeIdKey('2')]: { id: '2', v: 2 },
        },
      },
    },
    modify: {
      property: [{ func: 'getKey', value: 'a.b' }],
      func: 'delbyid',
      value: '2',
    },
    FieldValue,
    language: 'en_US',
  });

  assert.equal(result.category, 'atomic-transform');
  assert.deepEqual(Object.keys(result.update), []);
  assert.deepEqual(result.update[FIELD_PATH_UPDATES], [
    {
      segments: ['a.b', 'order'],
      value: { __op: 'arrayRemove', values: ['2'] },
    },
    {
      segments: ['a.b', 'valueById', encodeIdKey('2')],
      value: { __op: 'delete' },
    },
  ]);
});
