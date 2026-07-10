const EXISTENCE = {
  UNKNOWN: 'unknown',
  EXISTS: 'exists',
  MISSING: 'missing',
};

export const createUserDocSequencer = ({
  planAction,
  submitWrite,
  readCache,
  onChangeError,
}) => {
  let uid = null;
  let existence = EXISTENCE.UNKNOWN;
  let planningDoc = null;
  let queue = [];
  let unsettledCount = 0;
  let generation = 0;
  let lifecycleEpoch = 0;
  let rebaseRequestSequence = 0;
  let activeRebaseRequestToken = null;
  let draining = false;
  let disposed = false;

  // Clears the listener/planning epoch: existence, the planning document, the
  // pending queue, and any in-flight rebase. Deliberately leaves write-identity
  // state (`unsettledCount`, `lifecycleEpoch`) alone so already-submitted writes
  // still report their eventual outcome.
  const resetPlanningState = () => {
    existence = EXISTENCE.UNKNOWN;
    planningDoc = null;
    queue = [];
    generation += 1;
    activeRebaseRequestToken = null;
  };

  const reset = () => {
    resetPlanningState();
    unsettledCount = 0;
    lifecycleEpoch += 1;
  };

  const reportError = (error, fallbackCode) => {
    onChangeError(
      (error && error.code) || fallbackCode,
      (error && error.message) || String(error),
    );
  };

  const applyCacheResult = (captured, result) => {
    if (activeRebaseRequestToken !== captured.requestToken) {
      return;
    }
    activeRebaseRequestToken = null;
    if (
      disposed ||
      lifecycleEpoch !== captured.lifecycleEpoch ||
      uid !== captured.uid ||
      generation !== captured.generation
    ) {
      return;
    }
    if (captured.requireIdle && unsettledCount !== 0) {
      // A pending write will schedule the next rebase, which drains.
      return;
    }
    if (result) {
      if (result.exists) {
        existence = EXISTENCE.EXISTS;
        planningDoc = result.data || {};
      } else {
        existence = EXISTENCE.MISSING;
        planningDoc = null;
      }
    }
    // Drain even when the cache read failed: actions held back during the
    // rebase must not stall forever.
    drain();
  };

  const scheduleRebase = ({ requireIdle }) => {
    if (disposed || uid == null) {
      return;
    }
    const requestToken = ++rebaseRequestSequence;
    const captured = {
      uid,
      generation,
      lifecycleEpoch,
      requireIdle,
      requestToken,
    };
    activeRebaseRequestToken = requestToken;
    Promise.resolve()
      .then(() => readCache())
      .then(
        (result) => applyCacheResult(captured, result),
        () => applyCacheResult(captured, null),
      );
  };

  const trackWrite = (writePromise) => {
    // These callbacks exist only for writes submitted by this JS runtime.
    // Firestore-restored writes reconcile through snapshots after a reload,
    // but their original Promise callbacks cannot be restored.
    const writeEpoch = lifecycleEpoch;
    const writeUid = uid;
    unsettledCount += 1;
    writePromise.then(
      () => {
        if (writeEpoch !== lifecycleEpoch) {
          return;
        }
        unsettledCount -= 1;
        if (unsettledCount === 0) {
          scheduleRebase({ requireIdle: true });
        }
      },
      (error) => {
        if (writeEpoch === lifecycleEpoch) {
          unsettledCount -= 1;
          reportError(error, 'unknown');
          scheduleRebase({ requireIdle: false });
          return;
        }
        // Stale epoch: the unsettled bookkeeping was reset with the UID
        // change. But Firestore can resume and reject this write after the
        // originating user signed back in (offline queue survives UID
        // round-trips), and that user must still hear about the failure.
        if (!disposed && uid === writeUid) {
          reportError(error, 'unknown');
          scheduleRebase({ requireIdle: false });
        }
      },
    );
  };

  const drain = () => {
    if (draining || disposed) {
      return;
    }
    draining = true;
    try {
      // While a rebase is in flight, planningDoc may still contain a rejected
      // mutation; hold new actions until the corrective document lands.
      while (
        queue.length > 0 &&
        existence !== EXISTENCE.UNKNOWN &&
        activeRebaseRequestToken === null
      ) {
        const modify = queue.shift();

        if (existence === EXISTENCE.MISSING) {
          // Documented no-op: `change` never creates the user document.
          continue;
        }

        let plan;
        try {
          plan = planAction({ modify, userDoc: planningDoc });
        } catch (error) {
          reportError(error, 'change/planning-failed');
          continue;
        }
        if (!plan || plan.kind === 'noop') {
          continue;
        }
        if (plan.kind === 'invalid') {
          onChangeError(plan.reason, `Cannot apply change: ${plan.reason}`);
          continue;
        }

        let writePromise;
        try {
          writePromise = submitWrite({ plan });
        } catch (error) {
          reportError(error, 'change/submit-failed');
          continue;
        }

        generation += 1;
        planningDoc = plan.expectedDoc;
        trackWrite(writePromise);
        if (plan.kind === 'atomic-transform') {
          // Firestore's local view preserves transform semantics that are lost
          // once encoded values (such as integer vs double) become plain JS.
          scheduleRebase({ requireIdle: false });
        }
      }
    } finally {
      draining = false;
    }
  };

  return {
    setUid(nextUid) {
      if (nextUid === uid) {
        return;
      }
      uid = nextUid;
      reset();
    },

    enqueue({ uid: actionUid, modify }) {
      if (disposed) {
        return;
      }
      if (actionUid !== uid || uid == null) {
        onChangeError(
          'change/uid-mismatch',
          'Change action dropped: it was queued for a different user.',
        );
        return;
      }
      queue.push(modify);
      drain();
    },

    handleSnapshot({ uid: snapshotUid, exists, fromCache, getData }) {
      if (disposed || snapshotUid !== uid) {
        return;
      }

      // While UNKNOWN, snapshots always apply; afterwards they are dropped
      // whenever local writes or a rebase would be regressed by them.
      if (
        existence !== EXISTENCE.UNKNOWN &&
        (unsettledCount > 0 || activeRebaseRequestToken !== null)
      ) {
        return;
      }

      if (exists) {
        existence = EXISTENCE.EXISTS;
        planningDoc = getData() || {};
      } else if (!fromCache) {
        existence = EXISTENCE.MISSING;
        planningDoc = null;
      }
      drain();
    },

    handleListenerFailure({ uid: listenerUid }) {
      if (disposed || listenerUid !== uid) {
        return;
      }

      resetPlanningState();
    },

    dispose() {
      disposed = true;
      queue = [];
      lifecycleEpoch += 1;
    },

    inspect() {
      return {
        uid,
        existence,
        queueLength: queue.length,
        unsettledCount,
        generation,
        rebaseInFlight: activeRebaseRequestToken !== null,
        planningDoc,
      };
    },
  };
};
