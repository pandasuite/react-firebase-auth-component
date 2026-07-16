import {
  CHANGE_QUEUE_MAX,
  CHANGE_QUEUE_TIMEOUT_MS,
  describeChangeAuthState,
  queueChangeModify,
  resolvePendingChangePolicy,
  toQueuedChangeModify,
} from './changeActionQueue.mjs';

export const subscribeToChangeAuth = ({ auth, setUser, syncAuth }) => {
  if (
    auth === false ||
    auth === null ||
    typeof auth?.onIdTokenChanged !== 'function'
  ) {
    setUser(null);
    syncAuth(auth);
    return undefined;
  }

  const handleUser = (user) => {
    setUser(user);
    syncAuth({ currentUser: user });
  };

  handleUser(auth.currentUser ?? null);
  return auth.onIdTokenChanged(handleUser);
};

export const createChangeActionController = ({
  applyChange,
  sendChangeError,
  maxQueueSize = CHANGE_QUEUE_MAX,
  timeoutMs = CHANGE_QUEUE_TIMEOUT_MS,
  schedule = setTimeout,
  clearScheduled = clearTimeout,
}) => {
  let pendingChanges = [];
  let timeoutId = null;
  let synchronizedUid = null;

  const clearPendingTimeout = () => {
    if (timeoutId !== null) {
      clearScheduled(timeoutId);
      timeoutId = null;
    }
  };

  const failPendingChanges = ({ code, message }) => {
    const hasPendingChanges = pendingChanges.length > 0;
    pendingChanges = [];
    clearPendingTimeout();

    if (hasPendingChanges) {
      sendChangeError(code, message);
    }
  };

  const flushPendingChanges = (user) => {
    if (!user || pendingChanges.length === 0) {
      return;
    }

    const queued = pendingChanges;
    pendingChanges = [];
    clearPendingTimeout();

    queued.forEach(({ uid, modify }) => {
      if (uid === null || uid === user.uid) {
        applyChange({ user, modify });
      }
    });
  };

  const startPendingTimeout = () => {
    if (timeoutId !== null) {
      return;
    }

    timeoutId = schedule(() => {
      timeoutId = null;
      failPendingChanges({
        code: 'auth/wait-timeout',
        message:
          'Timed out waiting for an authenticated user to apply change actions.',
      });
    }, timeoutMs);
  };

  const enqueuePendingChange = (modify, uid = null) => {
    const { queue, dropped } = queueChangeModify({
      queue: pendingChanges,
      modify: { uid, modify },
      maxSize: maxQueueSize,
    });

    pendingChanges = queue;
    if (dropped) {
      sendChangeError(
        'auth/pending-overflow',
        'Too many pending change actions while waiting for authentication. Oldest action was dropped.',
      );
    }

    startPendingTimeout();
  };

  const handleIncomingChange = ({ payload, auth }) => {
    const modify = toQueuedChangeModify(payload);
    if (!modify) {
      return;
    }

    const authState = describeChangeAuthState(auth);

    if (authState === 'ready') {
      if (auth.currentUser.uid !== synchronizedUid) {
        enqueuePendingChange(modify, auth.currentUser.uid);
        return;
      }
      flushPendingChanges(auth.currentUser);
      applyChange({ user: auth.currentUser, modify });
      return;
    }

    if (authState === 'waiting-for-auth') {
      enqueuePendingChange(modify);
      return;
    }

    if (authState === 'invalid-config') {
      sendChangeError(
        'auth/invalid-config',
        'Cannot apply change because Firebase configuration is invalid.',
      );
      return;
    }

    sendChangeError(
      'auth/not-signed-in',
      'Cannot apply change because no user is signed in.',
    );
  };

  const syncAuth = (auth) => {
    const authState = describeChangeAuthState(auth);
    synchronizedUid = authState === 'ready' ? auth.currentUser.uid : null;
    const pendingPolicy = resolvePendingChangePolicy({
      authState,
      hasPendingChanges: pendingChanges.length > 0,
    });

    if (pendingPolicy === 'flush') {
      flushPendingChanges(auth.currentUser);
      return;
    }

    if (pendingPolicy === 'fail-invalid-config') {
      failPendingChanges({
        code: 'auth/invalid-config',
        message:
          'Cannot apply pending change actions because Firebase configuration is invalid.',
      });
      return;
    }

    // Keep pending changes when auth is temporarily signed-out. They will
    // either flush when user becomes ready or fail on timeout/invalid config.
  };

  const dispose = () => {
    pendingChanges = [];
    clearPendingTimeout();
  };

  return {
    handleIncomingChange,
    syncAuth,
    dispose,
  };
};
