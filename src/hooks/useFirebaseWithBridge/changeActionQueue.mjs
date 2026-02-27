export const CHANGE_QUEUE_MAX = 50;
export const CHANGE_QUEUE_TIMEOUT_MS = 10000;

export const toQueuedChangeModify = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const { property, func, value } = payload;
  if (property == null) {
    return null;
  }

  return { property, func, value };
};

export const describeChangeAuthState = (auth) => {
  if (auth === false) {
    return 'invalid-config';
  }

  if (!auth) {
    return 'waiting-for-auth';
  }

  if (auth.currentUser) {
    return 'ready';
  }

  return 'signed-out';
};

export const queueChangeModify = ({
  queue,
  modify,
  maxSize = CHANGE_QUEUE_MAX,
}) => {
  const nextQueue = Array.isArray(queue) ? [...queue] : [];
  let dropped = false;

  if (nextQueue.length >= maxSize) {
    nextQueue.shift();
    dropped = true;
  }

  nextQueue.push(modify);

  return {
    queue: nextQueue,
    dropped,
  };
};

export const resolvePendingChangePolicy = ({
  authState,
  hasPendingChanges,
}) => {
  if (!hasPendingChanges) {
    return 'noop';
  }

  if (authState === 'ready') {
    return 'flush';
  }

  if (authState === 'invalid-config') {
    return 'fail-invalid-config';
  }

  if (authState === 'signed-out') {
    return 'noop';
  }

  return 'noop';
};
