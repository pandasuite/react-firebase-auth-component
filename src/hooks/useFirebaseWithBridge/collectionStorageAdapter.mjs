const KEY_PREFIX = 'k_';

export const hasOwn = (obj, key) =>
  !!obj && Object.prototype.hasOwnProperty.call(obj, key);

const isPlainObject = (value) => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const isCollectionWrapper = (value) =>
  !!value && typeof value === 'object' && value.type === 'Collection';

export const isCanonicalCollectionWrapper = (value) =>
  isCollectionWrapper(value) &&
  Array.isArray(value.order) &&
  !!value.valueById &&
  typeof value.valueById === 'object';

const toStringId = (id) => {
  if (id === null || id === undefined) {
    return null;
  }
  return String(id);
};

const normalizeRow = (row, id) => {
  if (row && typeof row === 'object') {
    return { ...row, id };
  }
  return { id };
};

const hasNativeBuffer = () =>
  typeof globalThis !== 'undefined' &&
  !!globalThis.Buffer &&
  typeof globalThis.Buffer.from === 'function';

const encodeBase64Url = (input) => {
  const value = String(input);

  if (hasNativeBuffer()) {
    return globalThis.Buffer.from(value, 'utf8').toString('base64url');
  }

  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
};

const decodeBase64Url = (input) => {
  const value = String(input);

  if (hasNativeBuffer()) {
    return globalThis.Buffer.from(value, 'base64url').toString('utf8');
  }

  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export const encodeIdKey = (id) => `${KEY_PREFIX}${encodeBase64Url(id)}`;

export const decodeIdKey = (key) => {
  const input = String(key);
  if (!input.startsWith(KEY_PREFIX)) {
    return input;
  }
  return decodeBase64Url(input.slice(KEY_PREFIX.length));
};

export const normalizeCollection = (collection) => {
  const source =
    collection && typeof collection === 'object'
      ? collection
      : Object.create(null);
  const type = source.type;
  const schema = source.schema;
  const order = [];
  const valueById = Object.create(null);

  if (Array.isArray(source.value)) {
    for (const row of source.value) {
      const id = toStringId(row && row.id);
      if (id === null) {
        continue;
      }
      order.push(id);
      valueById[encodeIdKey(id)] = normalizeRow(row, id);
    }
  } else {
    const sourceOrder = Array.isArray(source.order) ? source.order : [];
    const sourceValueById =
      source.valueById && typeof source.valueById === 'object'
        ? source.valueById
        : Object.create(null);

    for (const rawId of sourceOrder) {
      const id = toStringId(rawId);
      if (id === null) {
        continue;
      }

      const encodedKey = encodeIdKey(id);
      const row = hasOwn(sourceValueById, encodedKey)
        ? sourceValueById[encodedKey]
        : sourceValueById[id];

      if (row === undefined) {
        continue;
      }

      order.push(id);
      valueById[encodedKey] = normalizeRow(row, id);
    }
  }

  return {
    type,
    schema,
    order,
    valueById,
  };
};

export const toLogicalCollectionValue = (collection) => {
  const normalized = normalizeCollection(collection);

  return normalized.order
    .map((id) => normalized.valueById[encodeIdKey(id)])
    .filter((row) => row !== undefined);
};

export const toCanonicalCollectionForStorage = (collection) => {
  const normalized = normalizeCollection(collection);
  const output = {
    type: 'Collection',
    order: normalized.order,
    valueById: normalized.valueById,
  };

  if (normalized.schema !== undefined) {
    output.schema = normalized.schema;
  }

  return output;
};

export const normalizeCollectionsForStorage = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeCollectionsForStorage);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = normalizeCollectionsForStorage(item);
  }

  if (!isCollectionWrapper(output)) {
    return output;
  }

  return toCanonicalCollectionForStorage(output);
};

export const hydrateCollectionsForLogicalUse = (value) => {
  if (Array.isArray(value)) {
    return value.map(hydrateCollectionsForLogicalUse);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = hydrateCollectionsForLogicalUse(item);
  }

  if (!isCanonicalCollectionWrapper(output)) {
    return output;
  }

  return {
    ...output,
    value: toLogicalCollectionValue(output),
  };
};

const toQueryableCollection = (collection) => {
  const output = {
    type: 'Collection',
  };

  if (collection?.schema !== undefined) {
    output.schema = collection.schema;
  }

  if (isCanonicalCollectionWrapper(collection)) {
    output.value = toLogicalCollectionValue(collection);
    return output;
  }

  if (Array.isArray(collection?.value)) {
    output.value = collection.value;
    return output;
  }

  output.value = toLogicalCollectionValue(collection);
  return output;
};

export const toQueryableShape = (value) => {
  if (Array.isArray(value)) {
    return value.map(toQueryableShape);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = toQueryableShape(item);
  }

  if (!isCollectionWrapper(output)) {
    return output;
  }

  return toQueryableCollection(output);
};
