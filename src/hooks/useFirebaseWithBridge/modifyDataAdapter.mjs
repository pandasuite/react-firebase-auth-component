import _ from 'lodash';

import {
  encodeIdKey,
  hasOwn,
  hydrateCollectionsForLogicalUse,
  isCanonicalCollectionWrapper,
  isCollectionWrapper,
  normalizeCollection,
  toCanonicalCollectionForStorage,
  toLogicalCollectionValue,
} from './collectionStorageAdapter.mjs';
import { buildPointerPlan } from './pointerPlanner.mjs';

const rawPandaValue = (value) => {
  if (value && typeof value === 'object' && typeof value.type === 'string') {
    return value.value;
  }
  return value;
};

const isPandaValueWrapper = (value) =>
  !!value &&
  typeof value === 'object' &&
  typeof value.type === 'string' &&
  Object.prototype.hasOwnProperty.call(value, 'value');

const unwrapCollectionsForPlanner = (value) => {
  if (Array.isArray(value)) {
    return value.map(unwrapCollectionsForPlanner);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (isCollectionWrapper(value)) {
    if (Array.isArray(value.value)) {
      return value.value.map(unwrapCollectionsForPlanner);
    }
    return toLogicalCollectionValue(value);
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = unwrapCollectionsForPlanner(item);
  }
  return output;
};

const toCollectionOutputShape = ({ originalCollection, logicalCollection }) => {
  if (!isCollectionWrapper(originalCollection)) {
    return logicalCollection;
  }

  return toCanonicalCollectionForStorage(logicalCollection);
};

const toOutputValueDeep = ({ originalValue, logicalValue }) => {
  if (isCollectionWrapper(originalValue) && isCollectionWrapper(logicalValue)) {
    return toCollectionOutputShape({
      originalCollection: originalValue,
      logicalCollection: logicalValue,
    });
  }

  if (Array.isArray(logicalValue)) {
    return logicalValue.map((item, index) =>
      toOutputValueDeep({
        originalValue: Array.isArray(originalValue)
          ? originalValue[index]
          : undefined,
        logicalValue: item,
      }),
    );
  }

  if (!logicalValue || typeof logicalValue !== 'object') {
    return logicalValue;
  }

  if (!_.isPlainObject(logicalValue)) {
    return logicalValue;
  }

  const output = {};
  for (const [key, item] of Object.entries(logicalValue)) {
    output[key] = toOutputValueDeep({
      originalValue:
        originalValue && typeof originalValue === 'object'
          ? originalValue[key]
          : undefined,
      logicalValue: item,
    });
  }
  return output;
};

const getOutputValueAtPath = ({
  originalUserData,
  logicalUserData,
  basePath,
}) => {
  const originalValue = _.get(originalUserData, basePath);
  const logicalValue = _.get(logicalUserData, basePath);

  return toOutputValueDeep({ originalValue, logicalValue });
};

const buildTargetedCollectionSetUpdate = ({
  collection,
  basePath,
  id,
  tailPath,
  value,
}) => {
  const normalized = normalizeCollection(collection);
  const encodedId = encodeIdKey(String(id));

  if (!hasOwn(normalized.valueById, encodedId)) {
    return null;
  }

  if (isCanonicalCollectionWrapper(collection)) {
    const path = tailPath
      ? `${basePath}.valueById.${encodedId}.${tailPath}`
      : `${basePath}.valueById.${encodedId}`;

    return { [path]: value };
  }

  const nextCollection = toCanonicalCollectionForStorage(collection);
  const nextRow = _.cloneDeep(nextCollection.valueById[encodedId]);

  if (tailPath) {
    const patchableRow =
      nextRow && typeof nextRow === 'object' ? nextRow : Object.create(null);
    _.set(patchableRow, tailPath, value);
    nextCollection.valueById[encodedId] = patchableRow;
  } else {
    nextCollection.valueById[encodedId] = value;
  }

  return {
    [basePath]: nextCollection,
  };
};

const buildCanonicalCollectionAddFastUpdate = ({
  basePath,
  originalCollection,
  logicalCollection,
}) => {
  if (!isCanonicalCollectionWrapper(originalCollection)) {
    return null;
  }

  const before = normalizeCollection(originalCollection);
  const after = normalizeCollection(logicalCollection);

  if (after.order.length !== before.order.length + 1) {
    return null;
  }

  const sharedPrefix = after.order.slice(0, before.order.length);
  if (!_.isEqual(sharedPrefix, before.order)) {
    return null;
  }

  const appendedId = after.order[after.order.length - 1];
  const encodedId = encodeIdKey(appendedId);

  if (
    hasOwn(before.valueById, encodedId) ||
    !hasOwn(after.valueById, encodedId)
  ) {
    return null;
  }

  for (const [key, row] of Object.entries(before.valueById)) {
    if (!_.isEqual(after.valueById[key], row)) {
      return null;
    }
  }

  return {
    [`${basePath}.order`]: after.order,
    [`${basePath}.valueById.${encodedId}`]: after.valueById[encodedId],
  };
};

const isPointerObjectArray = (value) =>
  Array.isArray(value) &&
  value.every(
    (item) => item && typeof item === 'object' && typeof item.func === 'string',
  );

const getPointerObjects = ({ JSONPointer, property }) => {
  if (!JSONPointer || property == null) {
    return [];
  }

  if (isPointerObjectArray(property)) {
    return property;
  }

  if (typeof property !== 'string') {
    return [];
  }

  return JSONPointer.getPointerByJSONPointer(property);
};

const toPathSegments = (pointerObjects) =>
  pointerObjects
    .map((ptr) => {
      if (ptr.func === 'getKey' && typeof ptr.value === 'string') {
        return ptr.value;
      }
      if (ptr.func === 'getByIndex' && /^\d+$/.test(String(ptr.value))) {
        return parseInt(ptr.value, 10);
      }
      return null;
    })
    .filter((segment) => segment !== null && segment !== undefined);

const getStableParentPath = (pointerObjects, endIndex) => {
  const stableSegments = [];

  for (const ptr of pointerObjects.slice(0, endIndex)) {
    if (ptr?.func !== 'getKey') {
      break;
    }

    if (typeof ptr?.value === 'string' && ptr.value !== '') {
      stableSegments.push(ptr.value);
    }
  }

  return stableSegments.join('.');
};

const applyModifyInPlaceSafely = ({
  ModifyData,
  userData,
  modify,
  language,
}) => {
  try {
    return ModifyData.applyInPlace(userData, modify, {
      obj: { unitPool: { language: language || 'en_US' } },
    });
  } catch {
    return false;
  }
};

export const resolvePointerSegments = ({
  JSONPointer,
  schema,
  property,
  language,
  allowFallback = true,
}) => {
  const resolvedPointer = [];

  if (!JSONPointer || !schema || property == null) {
    return resolvedPointer;
  }

  const pointer = Array.isArray(property)
    ? property
    : JSONPointer.getPointerByJSONPointer(property);

  let resolvedParentNode = null;
  try {
    resolvedParentNode = JSONPointer.resolvePointer(schema, pointer, {
      obj: {
        unitPool: {
          language: language || 'en_US',
        },
      },
      resolvedPointer,
      wantParentNode: true,
    });
  } catch {
    // If resolution throws, we still fallback below.
  }

  if (resolvedParentNode) {
    return resolvedPointer;
  }

  if (!allowFallback) {
    return [];
  }

  if (typeof property !== 'string') {
    return resolvedPointer;
  }

  return _.compact(property.replace(/@[^:]+:/g, '').split('/')).map(
    (segment) => {
      if (/^\d+$/.test(segment)) {
        return parseInt(segment, 10);
      }
      return segment;
    },
  );
};

const getDocumentFromPointer = (userData, pointer, value) => {
  const update = {};
  const index = _.findIndex(pointer, (key) => _.isNumber(key));

  if (index !== -1) {
    const path = pointer.slice(0, index).join('.');
    const subtree = _.get(userData, path);
    update[path] = _.cloneDeep(subtree);
    _.set(update[path], pointer.slice(index).join('.'), value);
  } else {
    update[pointer.join('.')] = value;
  }
  return update;
};

export const buildUserDocUpdate = ({
  JSONPointer,
  ModifyData,
  userData,
  modify,
  FieldValue,
  language,
}) => {
  if (!userData || typeof userData !== 'object') {
    return null;
  }

  if (!modify || typeof modify !== 'object') {
    return null;
  }

  const logicalUserData = hydrateCollectionsForLogicalUse(userData);
  const plannerUserData = unwrapCollectionsForPlanner(logicalUserData);
  const func = (modify.func || 'set').toLowerCase();
  const pointerObjects = getPointerObjects({
    JSONPointer,
    property: modify.property,
  });
  if (pointerObjects.length === 0) {
    return null;
  }

  const firstArraySelectorIndex = _.findIndex(
    pointerObjects,
    (ptr) => ptr?.func === 'getByIndex' || ptr?.func === 'getById',
  );
  const firstComputedSelectorIndex = _.findIndex(
    pointerObjects,
    (ptr) =>
      typeof ptr?.func === 'string' &&
      JSONPointer.isFunctionTypeComputedSelector(ptr.func),
  );

  if (func === 'set') {
    const plan = buildPointerPlan({
      JSONPointer,
      userData: plannerUserData,
      modify,
      language,
    });

    if (plan.kind === 'targeted') {
      const baseValue = _.get(userData, plan.basePath);
      if (isCollectionWrapper(baseValue)) {
        return buildTargetedCollectionSetUpdate({
          collection: baseValue,
          basePath: plan.basePath,
          id: plan.id,
          tailPath: plan.tailPath,
          value: modify.value,
        });
      }
    }
  }

  if (firstComputedSelectorIndex !== -1) {
    if (!ModifyData) {
      return null;
    }

    const basePath = getStableParentPath(
      pointerObjects,
      firstComputedSelectorIndex,
    );
    if (!basePath) {
      return null;
    }

    const changed = applyModifyInPlaceSafely({
      ModifyData,
      userData: logicalUserData,
      modify,
      language,
    });

    if (!changed) {
      return null;
    }

    return {
      [basePath]: getOutputValueAtPath({
        originalUserData: userData,
        logicalUserData,
        basePath,
      }),
    };
  }

  if (firstArraySelectorIndex !== -1 && func !== 'set') {
    if (!ModifyData) {
      return null;
    }

    const basePath = getStableParentPath(
      pointerObjects,
      firstArraySelectorIndex,
    );
    if (!basePath) {
      return null;
    }

    const changed = applyModifyInPlaceSafely({
      ModifyData,
      userData: logicalUserData,
      modify,
      language,
    });

    if (!changed) {
      return null;
    }

    return {
      [basePath]: getOutputValueAtPath({
        originalUserData: userData,
        logicalUserData,
        basePath,
      }),
    };
  }

  const hasGetById = pointerObjects.some((ptr) => ptr?.func === 'getById');
  const pointer = hasGetById
    ? resolvePointerSegments({
        JSONPointer,
        schema: logicalUserData,
        property: modify.property,
        language,
        allowFallback: false,
      })
    : toPathSegments(pointerObjects);

  if (pointer.length === 0) {
    return null;
  }

  if (pointer.some((segment) => typeof segment === 'number' && segment < 0)) {
    return null;
  }

  const pointerPath = pointer.join('.');
  const targetAtPointer = _.get(logicalUserData, pointerPath);
  const requiresWrapperSafeMutation =
    (func === 'add' || func === 'delbyid' || func === 'delbyvalue') &&
    isPandaValueWrapper(targetAtPointer);

  if (requiresWrapperSafeMutation) {
    if (!ModifyData) {
      return null;
    }

    const changed = applyModifyInPlaceSafely({
      ModifyData,
      userData: logicalUserData,
      modify,
      language,
    });

    if (!changed) {
      return null;
    }

    const originalAtPointer = _.get(userData, pointerPath);
    const logicalAtPointer = _.get(logicalUserData, pointerPath);
    const outputValue =
      isCollectionWrapper(originalAtPointer) &&
      isCollectionWrapper(logicalAtPointer)
        ? toCollectionOutputShape({
            originalCollection: originalAtPointer,
            logicalCollection: logicalAtPointer,
          })
        : logicalAtPointer;

    if (
      func === 'add' &&
      isCollectionWrapper(originalAtPointer) &&
      isCollectionWrapper(logicalAtPointer)
    ) {
      const fastUpdate = buildCanonicalCollectionAddFastUpdate({
        basePath: pointerPath,
        originalCollection: originalAtPointer,
        logicalCollection: logicalAtPointer,
      });
      if (fastUpdate) {
        return fastUpdate;
      }
    }

    return getDocumentFromPointer(logicalUserData, pointer, outputValue);
  }

  if (!FieldValue) {
    return null;
  }

  const rawValue = rawPandaValue(modify.value);
  let fieldValue = modify.value;

  if (func === 'inc') {
    const increment = Number(rawValue);
    fieldValue = FieldValue.increment(
      Number.isFinite(increment) ? increment : 0,
    );
  } else if (func === 'dec') {
    const decrement = Number(rawValue);
    fieldValue = FieldValue.increment(
      Number.isFinite(decrement) ? -decrement : 0,
    );
  } else if (func === 'del') {
    fieldValue = FieldValue.delete();
  } else if (func === 'add') {
    fieldValue = FieldValue.arrayUnion(modify.value);
  } else if (func === 'delbyid') {
    let base = _.get(userData, pointer.join('.'));
    if (base && base.value && Array.isArray(base.value)) {
      base = base.value;
    }

    const idToRemove = rawPandaValue(modify.value);
    const doc = _.find(base, (row) => rawPandaValue(row?.id) === idToRemove);
    if (!doc) {
      return null;
    }
    fieldValue = FieldValue.arrayRemove(doc);
  } else if (func === 'delbyvalue') {
    fieldValue = FieldValue.arrayRemove(modify.value);
  }

  return getDocumentFromPointer(userData, pointer, fieldValue);
};
