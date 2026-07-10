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

export const FIELD_PATH_UPDATES = Symbol('fieldPathUpdates');

const FIRESTORE_FIELD_PATH_METACHARACTERS = ['.', '~', '*', '/', '[', ']'];

const requiresStructuredFieldPath = (segment) =>
  FIRESTORE_FIELD_PATH_METACHARACTERS.some((character) =>
    segment.includes(character),
  );

const buildFieldPathAwareUpdate = (entries) => {
  const update = {};
  const fieldPathUpdates = [];

  for (const { segments, value } of entries) {
    const stringSegments = segments.map(String);
    if (stringSegments.some(requiresStructuredFieldPath)) {
      fieldPathUpdates.push({ segments: stringSegments, value });
    } else {
      update[stringSegments.join('.')] = value;
    }
  }

  if (fieldPathUpdates.length > 0) {
    update[FIELD_PATH_UPDATES] = fieldPathUpdates;
  }

  return update;
};

const rawPandaValue = (value) => {
  if (value && typeof value === 'object' && typeof value.type === 'string') {
    return value.value;
  }
  return value;
};

const rawModifyDataValue = (value) => {
  if (value && typeof value === 'object' && value.value !== undefined) {
    return value.type === 'Page'
      ? _.get(value, 'value.did', null)
      : value.value;
  }
  return value;
};

const toFiniteOperand = (value) => (Number.isFinite(value) ? value : 0);

const isPandaValueWrapper = (value) =>
  !!value &&
  typeof value === 'object' &&
  typeof value.type === 'string' &&
  Object.prototype.hasOwnProperty.call(value, 'value');

const hasWrappedValue = (value) =>
  !!value && typeof value === 'object' && !!value.value;

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

  if (!_.isPlainObject(value)) {
    return value;
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
  baseSegments,
}) => {
  const path =
    Array.isArray(baseSegments) && baseSegments.length > 0
      ? baseSegments
      : basePath;
  const originalValue = _.get(originalUserData, path);
  const logicalValue = _.get(logicalUserData, path);

  return toOutputValueDeep({ originalValue, logicalValue });
};

const buildTargetedCollectionSetUpdate = ({
  collection,
  baseSegments,
  id,
  tailSegments,
  value,
}) => {
  const normalized = normalizeCollection(collection);
  const encodedId = encodeIdKey(String(id));

  if (!hasOwn(normalized.valueById, encodedId)) {
    return null;
  }

  if (isCanonicalCollectionWrapper(collection)) {
    return buildFieldPathAwareUpdate([
      {
        segments: [
          ...baseSegments,
          'valueById',
          encodedId,
          ...tailSegments,
        ],
        value,
      },
    ]);
  }

  const nextCollection = toCanonicalCollectionForStorage(collection);
  const nextRow = _.cloneDeep(nextCollection.valueById[encodedId]);

  if (tailSegments.length > 0) {
    const patchableRow =
      nextRow && typeof nextRow === 'object' ? nextRow : Object.create(null);
    _.set(patchableRow, tailSegments, value);
    nextCollection.valueById[encodedId] = patchableRow;
  } else {
    nextCollection.valueById[encodedId] = value;
  }

  return buildFieldPathAwareUpdate([
    { segments: baseSegments, value: nextCollection },
  ]);
};

// Firestore's arrayUnion/arrayRemove match by exact value, so membership
// transforms must target the value actually stored in `order` (which may be
// an unnormalized numeric id). Returns undefined unless exactly one stored
// entry matches the normalized id — callers then fall back to a rewrite.
const getExactMembershipValue = (collection, id) => {
  const rawOrder = Array.isArray(collection?.order) ? collection.order : [];
  const matches = rawOrder.filter((rawId) => String(rawId) === id);
  return matches.length === 1 ? matches[0] : undefined;
};

const getStoredCollectionRowKey = (collection, id) => {
  const stringId = String(id);
  const encodedId = encodeIdKey(stringId);
  const valueById = collection?.valueById;

  if (valueById && typeof valueById === 'object') {
    if (hasOwn(valueById, encodedId)) {
      return encodedId;
    }
    if (hasOwn(valueById, stringId)) {
      return stringId;
    }
  }

  return encodedId;
};

// Emits the two-entry update that atomically drops a row: `arrayRemove` on the
// membership `order` plus `delete()` on the `valueById` entry.
const buildMembershipDeleteUpdate = ({
  baseSegments,
  membershipValues,
  rowKey,
  FieldValue,
}) =>
  buildFieldPathAwareUpdate([
    {
      segments: [...baseSegments, 'order'],
      value: FieldValue.arrayRemove(...membershipValues),
    },
    {
      segments: [...baseSegments, 'valueById', rowKey],
      value: FieldValue.delete(),
    },
  ]);

const buildCanonicalCollectionAddFastUpdate = ({
  baseSegments,
  originalCollection,
  logicalCollection,
  addedValue,
  FieldValue,
}) => {
  if (!isCanonicalCollectionWrapper(originalCollection) || !FieldValue) {
    return null;
  }

  const before = normalizeCollection(originalCollection);
  const after = normalizeCollection(logicalCollection);

  const isAppend =
    after.order.length === before.order.length + 1 &&
    _.isEqual(after.order.slice(0, before.order.length), before.order);
  const isSameOrder = _.isEqual(after.order, before.order);

  if (!isAppend && !isSameOrder) {
    return null;
  }

  const changedIds = [];
  for (const id of after.order) {
    const key = encodeIdKey(id);
    if (!_.isEqual(after.valueById[key], before.valueById[key])) {
      changedIds.push(id);
    }
  }

  if (changedIds.length === 0 && isSameOrder) {
    const addedId = rawPandaValue(addedValue?.id);
    const normalizedId = addedId == null ? null : String(addedId);
    if (
      normalizedId !== null &&
      hasOwn(after.valueById, encodeIdKey(normalizedId))
    ) {
      changedIds.push(normalizedId);
    }
  }

  if (changedIds.length !== 1) {
    return null;
  }

  const [changedId] = changedIds;
  if (isAppend && after.order[after.order.length - 1] !== changedId) {
    return null;
  }

  let membershipValue = changedId;
  if (isSameOrder) {
    membershipValue = getExactMembershipValue(originalCollection, changedId);
    if (membershipValue === undefined) {
      return null;
    }
  }

  const encodedId = encodeIdKey(changedId);
  return buildFieldPathAwareUpdate([
    {
      segments: [...baseSegments, 'order'],
      value: FieldValue.arrayUnion(membershipValue),
    },
    {
      segments: [...baseSegments, 'valueById', encodedId],
      value: after.valueById[encodedId],
    },
  ]);
};

const buildCanonicalCollectionDeleteByIdUpdate = ({
  baseSegments,
  originalCollection,
  id,
  FieldValue,
}) => {
  if (!isCanonicalCollectionWrapper(originalCollection) || !FieldValue) {
    return null;
  }

  const rawId = rawModifyDataValue(id);
  if (rawId === null || rawId === undefined) {
    return null;
  }

  const stringId = String(rawId);
  const membershipMatches = originalCollection.order.filter(
    (storedId) => String(storedId) === stringId,
  );
  if (membershipMatches.length > 1) {
    return null;
  }

  let membershipValues;
  if (membershipMatches.length === 1) {
    membershipValues = membershipMatches;
  } else {
    // Row absent locally: the remote membership may be stored as either the
    // string id or its numeric form, so arrayRemove must target both.
    membershipValues = [stringId];
    const numericId = Number(stringId);
    if (String(numericId) === stringId) {
      membershipValues.push(numericId);
    }
  }
  return buildMembershipDeleteUpdate({
    baseSegments,
    membershipValues,
    rowKey: getStoredCollectionRowKey(originalCollection, stringId),
    FieldValue,
  });
};

const buildCanonicalCollectionDeleteFastUpdate = ({
  baseSegments,
  originalCollection,
  logicalCollection,
  FieldValue,
}) => {
  if (!isCanonicalCollectionWrapper(originalCollection) || !FieldValue) {
    return null;
  }

  const before = normalizeCollection(originalCollection);
  const after = normalizeCollection(logicalCollection);

  if (after.order.length !== before.order.length - 1) {
    return null;
  }

  const afterIds = new Set(after.order);
  const removedIds = before.order.filter((id) => !afterIds.has(id));
  if (removedIds.length !== 1) {
    return null;
  }

  const [removedId] = removedIds;
  if (
    !_.isEqual(
      after.order,
      before.order.filter((id) => id !== removedId),
    )
  ) {
    return null;
  }

  for (const id of after.order) {
    const key = encodeIdKey(id);
    if (!_.isEqual(after.valueById[key], before.valueById[key])) {
      return null;
    }
  }

  const membershipValue = getExactMembershipValue(originalCollection, removedId);
  if (membershipValue === undefined) {
    return null;
  }

  return buildMembershipDeleteUpdate({
    baseSegments,
    membershipValues: [membershipValue],
    rowKey: getStoredCollectionRowKey(originalCollection, removedId),
    FieldValue,
  });
};

// Deleting a whole row must fix membership too: dropping only the valueById
// entry would leave a dangling id in `order`.
const buildCanonicalRowDeleteUpdate = ({
  collection,
  baseSegments,
  id,
  FieldValue,
}) => {
  if (!FieldValue) {
    return null;
  }

  const stringId = String(id);
  const membershipValue = getExactMembershipValue(collection, stringId);
  if (membershipValue === undefined) {
    return null;
  }

  const encodedId = encodeIdKey(stringId);
  if (!hasOwn(normalizeCollection(collection).valueById, encodedId)) {
    return null;
  }

  return buildMembershipDeleteUpdate({
    baseSegments,
    membershipValues: [membershipValue],
    rowKey: getStoredCollectionRowKey(collection, stringId),
    FieldValue,
  });
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

export const parsePointerObjects = ({ JSONPointer, property }) => {
  try {
    return getPointerObjects({ JSONPointer, property }) || [];
  } catch {
    return [];
  }
};

const toPathSegments = (pointerObjects) =>
  pointerObjects
    .map((ptr) => {
      if (
        (ptr.func === 'getKey' || ptr.func === 'getByKey') &&
        typeof ptr.value === 'string'
      ) {
        return ptr.value;
      }
      if (ptr.func === 'getByIndex' && /^\d+$/.test(String(ptr.value))) {
        return parseInt(ptr.value, 10);
      }
      return null;
    })
    .filter((segment) => segment !== null && segment !== undefined);

const getStableParentSegments = (pointerObjects, endIndex) => {
  const stableSegments = [];

  for (const ptr of pointerObjects.slice(0, endIndex)) {
    if (ptr?.func !== 'getKey' && ptr?.func !== 'getByKey') {
      break;
    }

    if (typeof ptr?.value === 'string' && ptr.value !== '') {
      stableSegments.push(ptr.value);
    }
  }

  return stableSegments;
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
    return null;
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
  const firstUnaddressableSegmentIndex = _.findIndex(
    pointer,
    (segment) =>
      typeof segment === 'string' && requiresStructuredFieldPath(segment),
  );

  if (index !== -1) {
    const parentSegments = pointer.slice(0, index);
    const subtree = _.cloneDeep(_.get(userData, parentSegments));
    _.set(subtree, pointer.slice(index), value);
    return buildFieldPathAwareUpdate([
      { segments: parentSegments, value: subtree },
    ]);
  }

  if (firstUnaddressableSegmentIndex >= 0) {
    return {
      [FIELD_PATH_UPDATES]: [{ segments: pointer.map(String), value }],
    };
  }

  update[pointer.join('.')] = value;
  return update;
};

const classifyUpdate = (category, update) =>
  update ? { category, update } : null;

export const buildClassifiedUserDocUpdate = ({
  JSONPointer,
  ModifyData,
  userData,
  modify,
  FieldValue,
  language,
  pointerObjects: providedPointerObjects,
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
  const isAtomicTransform =
    func === 'inc' ||
    func === 'dec' ||
    func === 'del' ||
    func === 'add' ||
    func === 'delbyid' ||
    func === 'delbyvalue';
  const pointerObjects =
    providedPointerObjects ||
    getPointerObjects({ JSONPointer, property: modify.property });
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

  // `add` is excluded from the canonical fast path: arrayUnion cannot
  // express ModifyData's ID-upsert semantics (adding {id, ...} over an
  // existing same-ID row must merge, not append a duplicate).
  const canTargetCanonicalRow = isAtomicTransform && func !== 'add';

  let targeted = null;
  if (func === 'set' || canTargetCanonicalRow) {
    const plan = buildPointerPlan({
      JSONPointer,
      userData: plannerUserData,
      modify,
      language,
    });

    if (plan.kind === 'targeted') {
      const selectorIndex = Math.min(
        ...[firstArraySelectorIndex, firstComputedSelectorIndex].filter(
          (index) => index >= 0,
        ),
      );
      const baseSegments = getStableParentSegments(
        pointerObjects,
        selectorIndex,
      );
      targeted = {
        id: plan.id,
        baseSegments,
        tailSegments: pointerObjects
          .slice(selectorIndex + 1)
          .map((ptr) => ptr.value),
        baseValue: _.get(userData, baseSegments),
      };
    }
  }

  if (func === 'set' && targeted && isCollectionWrapper(targeted.baseValue)) {
    const update = buildTargetedCollectionSetUpdate({
      collection: targeted.baseValue,
      baseSegments: targeted.baseSegments,
      id: targeted.id,
      tailSegments: targeted.tailSegments,
      value: modify.value,
    });
    return classifyUpdate(
      isCanonicalCollectionWrapper(targeted.baseValue)
        ? 'targeted-write'
        : 'local-rewrite',
      update,
    );
  }

  let canonicalTransformPointer = null;
  if (
    canTargetCanonicalRow &&
    targeted &&
    isCanonicalCollectionWrapper(targeted.baseValue)
  ) {
    if (func === 'del' && targeted.tailSegments.length === 0) {
      const update = buildCanonicalRowDeleteUpdate({
        collection: targeted.baseValue,
        baseSegments: targeted.baseSegments,
        id: targeted.id,
        FieldValue,
      });
      if (update) {
        return classifyUpdate('atomic-transform', update);
      }
      // Ambiguous membership: fall through to a ModifyData local rewrite.
    } else {
      const rowPointer = [
        ...targeted.baseSegments,
        'valueById',
        encodeIdKey(targeted.id),
        ...targeted.tailSegments,
      ];
      const currentValue = _.get(userData, rowPointer);
      if (func === 'inc' || func === 'dec') {
        const firestoreOperand = toFiniteOperand(
          Number(rawPandaValue(modify.value)),
        );
        const modifyDataOperand = toFiniteOperand(
          parseFloat(rawModifyDataValue(modify.value)),
        );

        let isMissingMapLeaf = false;
        if (currentValue === undefined) {
          const currentParent = _.get(userData, rowPointer.slice(0, -1));
          isMissingMapLeaf =
            _.isPlainObject(currentParent) && !isPandaValueWrapper(currentParent);
        }

        if (
          (Number.isFinite(currentValue) || isMissingMapLeaf) &&
          firestoreOperand === modifyDataOperand
        ) {
          canonicalTransformPointer = rowPointer;
        }
      } else if (func === 'del') {
        if (!isPandaValueWrapper(currentValue)) {
          canonicalTransformPointer = rowPointer;
        }
      } else if (func === 'delbyid') {
        // ModifyData intentionally treats numeric and string IDs as equivalent.
        const idToRemove = rawModifyDataValue(modify.value);
        const matchingRows =
          idToRemove != null && Array.isArray(currentValue)
            ? currentValue.filter(
                // eslint-disable-next-line eqeqeq
                (row) => rawModifyDataValue(row?.id) == idToRemove,
              )
            : [];

        if (
          matchingRows.length === 1 &&
          rawPandaValue(matchingRows[0]?.id) === rawPandaValue(modify.value)
        ) {
          canonicalTransformPointer = rowPointer;
        }
      } else if (func === 'delbyvalue') {
        if (
          Array.isArray(currentValue) &&
          !hasWrappedValue(modify.value) &&
          !currentValue.some(hasWrappedValue)
        ) {
          canonicalTransformPointer = rowPointer;
        }
      }
    }
  }

  if (firstComputedSelectorIndex !== -1 && canonicalTransformPointer === null) {
    if (!ModifyData) {
      return null;
    }

    const baseSegments = getStableParentSegments(
      pointerObjects,
      firstComputedSelectorIndex,
    );
    if (!baseSegments || baseSegments.length === 0) {
      return null;
    }
    const changed = applyModifyInPlaceSafely({
      ModifyData,
      userData: logicalUserData,
      modify,
      language,
    });

    if (changed === null) {
      return null;
    }

    if (!changed) {
      const selectorResolved =
        func === 'set' &&
        resolvePointerSegments({
          JSONPointer,
          schema: logicalUserData,
          property: modify.property,
          language,
          allowFallback: false,
        }).length > 0;
      if (!selectorResolved) {
        return null;
      }
    }

    const outputValue = getOutputValueAtPath({
      originalUserData: userData,
      logicalUserData,
      baseSegments,
    });
    return classifyUpdate(
      'local-rewrite',
      getDocumentFromPointer(userData, baseSegments, outputValue),
    );
  }

  if (
    firstArraySelectorIndex !== -1 &&
    func !== 'set' &&
    canonicalTransformPointer === null
  ) {
    if (!ModifyData) {
      return null;
    }

    const baseSegments = getStableParentSegments(
      pointerObjects,
      firstArraySelectorIndex,
    );
    if (!baseSegments || baseSegments.length === 0) {
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

    const outputValue = getOutputValueAtPath({
      originalUserData: userData,
      logicalUserData,
      baseSegments,
    });
    return classifyUpdate(
      'local-rewrite',
      getDocumentFromPointer(userData, baseSegments, outputValue),
    );
  }

  const hasGetById = pointerObjects.some((ptr) => ptr?.func === 'getById');
  const pointer =
    canonicalTransformPointer ||
    (hasGetById
      ? resolvePointerSegments({
          JSONPointer,
          schema: logicalUserData,
          property: modify.property,
          language,
          allowFallback: false,
        })
      : toPathSegments(pointerObjects));

  if (pointer.length === 0) {
    return null;
  }

  if (pointer.some((segment) => typeof segment === 'number' && segment < 0)) {
    return null;
  }

  const targetAtPointer = _.get(logicalUserData, pointer);
  const originalAtPointer = _.get(userData, pointer);

  if (
    func === 'delbyid' &&
    isCanonicalCollectionWrapper(originalAtPointer)
  ) {
    const update = buildCanonicalCollectionDeleteByIdUpdate({
      baseSegments: pointer,
      originalCollection: originalAtPointer,
      id: modify.value,
      FieldValue,
    });
    if (update) {
      return classifyUpdate('atomic-transform', update);
    }
  }

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

    const logicalAtPointer = _.get(logicalUserData, pointer);
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
        baseSegments: pointer,
        originalCollection: originalAtPointer,
        logicalCollection: logicalAtPointer,
        addedValue: modify.value,
        FieldValue,
      });
      if (fastUpdate) {
        return classifyUpdate('atomic-transform', fastUpdate);
      }
    }

    if (
      (func === 'delbyid' || func === 'delbyvalue') &&
      isCollectionWrapper(originalAtPointer) &&
      isCollectionWrapper(logicalAtPointer)
    ) {
      const fastUpdate = buildCanonicalCollectionDeleteFastUpdate({
        baseSegments: pointer,
        originalCollection: originalAtPointer,
        logicalCollection: logicalAtPointer,
        FieldValue,
      });
      if (fastUpdate) {
        return classifyUpdate('atomic-transform', fastUpdate);
      }
    }

    return classifyUpdate(
      'local-rewrite',
      getDocumentFromPointer(logicalUserData, pointer, outputValue),
    );
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
    let base = _.get(userData, pointer);
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

  let category = 'targeted-write';
  if (isAtomicTransform) {
    category = 'atomic-transform';
  } else if (func === 'set' && firstArraySelectorIndex !== -1) {
    category = 'local-rewrite';
  }

  return classifyUpdate(
    category,
    getDocumentFromPointer(userData, pointer, fieldValue),
  );
};

export const buildUserDocUpdate = (args) => {
  const classified = buildClassifiedUserDocUpdate(args);
  return classified ? classified.update : null;
};
