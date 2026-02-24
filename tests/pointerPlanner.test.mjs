import assert from 'node:assert/strict';
import test from 'node:test';

import { JSONPointer } from '@beingenious/jsonpointer';

import { buildPointerPlan } from '../src/hooks/useFirebaseWithBridge/pointerPlanner.mjs';

test('buildPointerPlan targets deterministic @getById chains', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 'a.1', name: 'A', score: 2 },
        { id: 'b.2', name: 'B', score: 1 },
      ],
    },
    modify: {
      property: '/items/@getById:b.2/name',
      func: 'set',
      value: 'B2',
    },
  });

  assert.deepEqual(plan, {
    kind: 'targeted',
    basePath: 'items',
    id: 'b.2',
    tailPath: 'name',
  });
});

test('buildPointerPlan allows empty tailPath when selector is final segment', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 'a.1', name: 'A', score: 2 },
        { id: 'b.2', name: 'B', score: 1 },
      ],
    },
    modify: {
      property: '/items/@getById:b.2',
      func: 'set',
      value: { id: 'b.2', name: 'B2' },
    },
  });

  assert.deepEqual(plan, {
    kind: 'targeted',
    basePath: 'items',
    id: 'b.2',
    tailPath: '',
  });
});

test('buildPointerPlan rewrites @getById when id is duplicated in base collection', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 'b.2', name: 'B1' },
        { id: 'b.2', name: 'B2' },
      ],
    },
    modify: {
      property: '/items/@getById:b.2/name',
      func: 'set',
      value: 'B3',
    },
  });

  assert.deepEqual(plan, {
    kind: 'rewrite',
    basePath: 'items',
  });
});

test('buildPointerPlan targets deterministic @find:id|eq|<id> chains', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 'a.1', name: 'A', score: 2 },
        { id: 'b.2', name: 'B', score: 1 },
      ],
    },
    modify: {
      property: '/items/@find:id|eq|a.1/name',
      func: 'set',
      value: 'A2',
    },
  });

  assert.deepEqual(plan, {
    kind: 'targeted',
    basePath: 'items',
    id: 'a.1',
    tailPath: 'name',
  });
});

test('buildPointerPlan rewrites @find:id|eq when id is duplicated in base collection', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 'a.1', name: 'A1' },
        { id: 'a.1', name: 'A2' },
      ],
    },
    modify: {
      property: '/items/@find:id|eq|a.1/name',
      func: 'set',
      value: 'A3',
    },
  });

  assert.deepEqual(plan, {
    kind: 'rewrite',
    basePath: 'items',
  });
});

test('buildPointerPlan targets @minBy when winner is unique', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 'a', score: 5, name: 'A' },
        { id: 'b', score: 1, name: 'B' },
      ],
    },
    modify: {
      property: '/items/@minBy:score/name',
      func: 'set',
      value: 'winner',
    },
  });

  assert.deepEqual(plan, {
    kind: 'targeted',
    basePath: 'items',
    id: 'b',
    tailPath: 'name',
  });
});

test('buildPointerPlan targets runtime first winner for @minBy ties', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 'a', score: 1, name: 'A' },
        { id: 'b', score: 1, name: 'B' },
      ],
    },
    modify: {
      property: '/items/@minBy:score/name',
      func: 'set',
      value: 'winner',
    },
  });

  assert.deepEqual(plan, {
    kind: 'targeted',
    basePath: 'items',
    id: 'a',
    tailPath: 'name',
  });
});

test('buildPointerPlan targets @maxBy when winner is unique', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 'a', score: 5, name: 'A' },
        { id: 'b', score: 1, name: 'B' },
      ],
    },
    modify: {
      property: '/items/@maxBy:score/name',
      func: 'set',
      value: 'winner',
    },
  });

  assert.deepEqual(plan, {
    kind: 'targeted',
    basePath: 'items',
    id: 'a',
    tailPath: 'name',
  });
});

test('buildPointerPlan targets runtime first winner for @maxBy ties', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 'a', score: 5, name: 'A' },
        { id: 'b', score: 5, name: 'B' },
      ],
    },
    modify: {
      property: '/items/@maxBy:score/name',
      func: 'set',
      value: 'winner',
    },
  });

  assert.deepEqual(plan, {
    kind: 'targeted',
    basePath: 'items',
    id: 'a',
    tailPath: 'name',
  });
});

test('buildPointerPlan rewrites @maxBy when there is no valid winner', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [{ name: 'A' }, { name: 'B' }],
    },
    modify: {
      property: '/items/@maxBy:score/name',
      func: 'set',
      value: 'winner',
    },
  });

  assert.deepEqual(plan, {
    kind: 'rewrite',
    basePath: 'items',
  });
});

test('buildPointerPlan falls back safely when base collection is missing', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {},
    modify: {
      property: '/items/@getById:b.2/name',
      func: 'set',
      value: 'B2',
    },
  });

  assert.notEqual(plan.kind, 'targeted');
  assert.ok(plan.kind === 'rewrite' || plan.kind === 'noop');
});

test('buildPointerPlan aligns @getById coercion with runtime selector resolution', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 2, name: 'n2' },
        { id: '02', name: 'n02' },
      ],
    },
    modify: {
      property: '/items/@getById:02/name',
      func: 'set',
      value: 'X',
    },
  });

  assert.deepEqual(plan, {
    kind: 'targeted',
    basePath: 'items',
    id: '2',
    tailPath: 'name',
  });
});

test('buildPointerPlan aligns @minBy winner selection with runtime selector resolution', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        { id: 'a', score: null, name: 'A' },
        { id: 'b', score: 0, name: 'B' },
      ],
    },
    modify: {
      property: '/items/@minBy:score/name',
      func: 'set',
      value: 'winner',
    },
  });

  assert.deepEqual(plan, {
    kind: 'targeted',
    basePath: 'items',
    id: 'b',
    tailPath: 'name',
  });
});

test('buildPointerPlan respects runtime language for locale-driven @minBy winners', () => {
  const plan = buildPointerPlan({
    JSONPointer,
    userData: {
      items: [
        {
          id: 'a',
          name: 'z',
          locale_name: { type: 'Language', value: { en_US: 'z', fr_FR: 'a' } },
        },
        {
          id: 'b',
          name: 'a',
          locale_name: { type: 'Language', value: { en_US: 'a', fr_FR: 'z' } },
        },
      ],
    },
    modify: {
      property: '/items/@minBy:name/name',
      func: 'set',
      value: 'winner',
    },
    language: 'fr_FR',
  });

  assert.deepEqual(plan, {
    kind: 'targeted',
    basePath: 'items',
    id: 'a',
    tailPath: 'name',
  });
});
