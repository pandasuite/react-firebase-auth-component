const cloneRegExp = (value) => new RegExp(value.source, value.flags);
const isPlainObject = (value) => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const ensureStructuredClone = () => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone;
  }

  const fallbackStructuredClone = (value) => {
    if (value instanceof RegExp) {
      return cloneRegExp(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => fallbackStructuredClone(item));
    }

    if (isPlainObject(value)) {
      const cloned = {};

      for (const key in value) {
        cloned[key] = fallbackStructuredClone(value[key]);
      }

      return cloned;
    }

    if (value && typeof value === 'object') {
      throw new TypeError(
        'Cannot structuredClone unsupported object in fallback',
      );
    }

    return value;
  };

  globalThis.structuredClone = fallbackStructuredClone;
  return globalThis.structuredClone;
};
