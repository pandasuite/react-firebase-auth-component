import _ from 'lodash';

import { FIELD_PATH_UPDATES } from './modifyDataAdapter.mjs';

const SENTINEL_KEY = '__pandaFsSentinel';
const SENTINEL_BRAND = Symbol('pandaFsSentinel');

export const plannerFieldValue = {
  increment: (operand) => ({
    [SENTINEL_BRAND]: true,
    [SENTINEL_KEY]: 'increment',
    operand,
  }),
  delete: () => ({
    [SENTINEL_BRAND]: true,
    [SENTINEL_KEY]: 'delete',
  }),
  arrayUnion: (...values) => ({
    [SENTINEL_BRAND]: true,
    [SENTINEL_KEY]: 'arrayUnion',
    values,
  }),
  arrayRemove: (...values) => ({
    [SENTINEL_BRAND]: true,
    [SENTINEL_KEY]: 'arrayRemove',
    values,
  }),
};

export const isSentinel = (value) =>
  !!value &&
  typeof value === 'object' &&
  value[SENTINEL_BRAND] === true &&
  typeof value[SENTINEL_KEY] === 'string';

const applySentinel = (current, sentinel) => {
  const kind = sentinel[SENTINEL_KEY];

  if (kind === 'increment') {
    // Firestore applies IEEE arithmetic to any numeric current value
    // (NaN stays NaN, infinities stay infinite) and only substitutes the
    // operand when the field is missing or non-numeric.
    return typeof current === 'number'
      ? current + sentinel.operand
      : sentinel.operand;
  }

  if (kind === 'arrayUnion') {
    const base = Array.isArray(current) ? [...current] : [];
    for (const value of sentinel.values) {
      if (!base.some((item) => _.isEqual(item, value))) {
        base.push(_.cloneDeep(value));
      }
    }
    return base;
  }

  if (kind === 'arrayRemove') {
    const base = Array.isArray(current) ? current : [];
    return base.filter(
      (item) => !sentinel.values.some((value) => _.isEqual(item, value)),
    );
  }

  return undefined;
};

const setAtSegments = (target, segments, value) => {
  if (segments.some((segment) => String(segment) === '__proto__')) {
    return;
  }

  const isDelete = isSentinel(value) && value[SENTINEL_KEY] === 'delete';

  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = String(segments[i]);
    if (!_.isPlainObject(cursor[key])) {
      if (isDelete) {
        // Firestore leaves the document untouched when a nested delete
        // targets a missing or non-map parent; never materialize parents.
        return;
      }
      cursor[key] = {};
    }
    cursor = cursor[key];
  }

  const leaf = String(segments[segments.length - 1]);
  const current = cursor[leaf];

  if (isSentinel(value)) {
    if (value[SENTINEL_KEY] === 'delete') {
      delete cursor[leaf];
      return;
    }
    cursor[leaf] = applySentinel(current, value);
    return;
  }

  cursor[leaf] = _.cloneDeep(value);
};

export const applyUpdateToDoc = ({ doc, update }) => {
  const next = doc && typeof doc === 'object' ? _.cloneDeep(doc) : {};

  for (const [path, value] of Object.entries(update || {})) {
    setAtSegments(next, path.split('.'), value);
  }

  const fieldPathEntries = (update && update[FIELD_PATH_UPDATES]) || [];
  for (const { segments, value } of fieldPathEntries) {
    setAtSegments(next, segments, value);
  }

  return next;
};

export const toFirestoreValue = (value, FieldValue) => {
  if (!isSentinel(value)) {
    return value;
  }

  const kind = value[SENTINEL_KEY];
  if (kind === 'increment') {
    return FieldValue.increment(value.operand);
  }
  if (kind === 'delete') {
    return FieldValue.delete();
  }
  if (kind === 'arrayUnion') {
    return FieldValue.arrayUnion(...value.values);
  }
  return FieldValue.arrayRemove(...value.values);
};
