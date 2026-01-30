import _ from 'lodash';

const rawPandaValue = (value) => {
  if (value && typeof value === 'object' && typeof value.type === 'string') {
    return value.value;
  }
  return value;
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

    update[path] = _.get(userData, path);
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

  if (firstArraySelectorIndex !== -1 && func !== 'set') {
    if (!ModifyData) {
      return null;
    }

    const basePathSegments = pointerObjects
      .slice(0, firstArraySelectorIndex)
      .map((ptr) => ptr?.value)
      .filter((segment) => typeof segment === 'string' && segment !== '');
    const basePath = basePathSegments.join('.');
    if (!basePath) {
      return null;
    }

    const changed = ModifyData.applyInPlace(userData, modify, {
      obj: { unitPool: { language: language || 'en_US' } },
    });

    if (!changed) {
      return null;
    }

    return { [basePath]: _.get(userData, basePath) };
  }

  if (!FieldValue) {
    return null;
  }

  const hasGetById = pointerObjects.some((ptr) => ptr?.func === 'getById');
  const pointer = hasGetById
    ? resolvePointerSegments({
        JSONPointer,
        schema: userData,
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

  const rawValue = rawPandaValue(modify.value);
  let fieldValue = modify.value;

  if (func === 'inc') {
    const increment = parseInt(rawValue, 10);
    fieldValue = FieldValue.increment(
      Number.isFinite(increment) ? increment : 0,
    );
  } else if (func === 'dec') {
    const decrement = parseInt(rawValue, 10);
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
