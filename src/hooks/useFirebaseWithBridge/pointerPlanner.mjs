const TARGETABLE_SELECTOR_FUNCS = new Set([
  'getById',
  'getByIndex',
  'find',
  'minBy',
  'maxBy',
]);

const getPointerObjects = ({ JSONPointer, property }) => {
  if (Array.isArray(property)) {
    return property;
  }
  if (
    !JSONPointer ||
    typeof JSONPointer.getPointerByJSONPointer !== 'function' ||
    typeof property !== 'string'
  ) {
    return [];
  }

  try {
    return JSONPointer.getPointerByJSONPointer(property) || [];
  } catch {
    return [];
  }
};

const getByPathSegments = (obj, segments) => {
  let cursor = obj;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== 'object') {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
};

const getStableBaseSegments = (pointerObjects, selectorIndex) => {
  const base = [];
  for (const ptr of pointerObjects.slice(0, selectorIndex)) {
    if (!ptr || ptr.func !== 'getKey' || typeof ptr.value !== 'string') {
      return null;
    }
    base.push(ptr.value);
  }
  return base;
};

const getTailPath = (pointerObjects, selectorIndex) => {
  const tailSegments = [];
  for (const ptr of pointerObjects.slice(selectorIndex + 1)) {
    if (!ptr || ptr.func !== 'getKey' || typeof ptr.value !== 'string') {
      return null;
    }
    tailSegments.push(ptr.value);
  }
  return tailSegments.join('.');
};

const getFindEqId = (raw) => {
  const value = String(raw || '');
  const match = /^id\|eq\|(.+)$/.exec(value);
  if (!match) {
    return null;
  }
  return String(match[1]);
};

const countIdMatches = (baseValue, id) => {
  if (!Array.isArray(baseValue)) {
    return 0;
  }

  let count = 0;
  for (const row of baseValue) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    if (row.id === null || row.id === undefined) {
      continue;
    }
    if (String(row.id) === id) {
      count += 1;
    }
  }
  return count;
};

const getResolvedSelectorId = ({
  JSONPointer,
  userData,
  pointerObjects,
  selectorIndex,
  language,
}) => {
  if (
    !JSONPointer ||
    typeof JSONPointer.resolvePointer !== 'function' ||
    !Array.isArray(pointerObjects)
  ) {
    return null;
  }

  let resolved;
  try {
    resolved = JSONPointer.resolvePointer(
      userData,
      pointerObjects.slice(0, selectorIndex + 1),
      {
        obj: {
          unitPool: {
            language: language || 'en_US',
          },
        },
      },
    );
  } catch {
    return null;
  }

  if (!resolved || typeof resolved !== 'object') {
    return null;
  }

  if (resolved.type === 'Reference' && resolved.value != null) {
    return String(resolved.value);
  }

  if (resolved.id != null) {
    return String(resolved.id);
  }

  return null;
};

export const buildPointerPlan = ({
  JSONPointer,
  userData,
  modify,
  language,
}) => {
  if (!modify || typeof modify !== 'object') {
    return { kind: 'noop' };
  }

  const pointerObjects = getPointerObjects({
    JSONPointer,
    property: modify.property,
  });
  if (pointerObjects.length === 0) {
    return { kind: 'noop' };
  }

  const selectorIndex = pointerObjects.findIndex((ptr) =>
    TARGETABLE_SELECTOR_FUNCS.has(ptr && ptr.func),
  );
  if (selectorIndex === -1) {
    return { kind: 'noop' };
  }

  const selector = pointerObjects[selectorIndex];
  const baseSegments = getStableBaseSegments(pointerObjects, selectorIndex);
  if (!baseSegments || baseSegments.length === 0) {
    return { kind: 'noop' };
  }

  const basePath = baseSegments.join('.');
  const tailPath = getTailPath(pointerObjects, selectorIndex);
  if (tailPath === null) {
    return { kind: 'rewrite', basePath };
  }

  const baseValue = getByPathSegments(userData, baseSegments);
  if (baseValue === undefined || baseValue === null) {
    return { kind: 'rewrite', basePath };
  }

  if (selector.func === 'find' && getFindEqId(selector.value) === null) {
    return { kind: 'rewrite', basePath };
  }

  const resolvedId = getResolvedSelectorId({
    JSONPointer,
    userData,
    pointerObjects,
    selectorIndex,
    language,
  });
  if (resolvedId === null) {
    return { kind: 'rewrite', basePath };
  }

  if (countIdMatches(baseValue, resolvedId) !== 1) {
    return { kind: 'rewrite', basePath };
  }

  return {
    kind: 'targeted',
    basePath,
    id: resolvedId,
    tailPath,
  };
};
