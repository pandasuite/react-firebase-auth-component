import { createFirestoreChangeWriter } from './firestoreChangeWriter.mjs';
import { createUserDocSequencer } from './userDocSequencer.mjs';
import { planChange } from './mutationPlanner.mjs';

export const createChangeRuntime = ({
  firestore,
  FieldValue,
  FieldPath,
  JSONPointer,
  ModifyData,
  sendChangeError,
  language,
}) => {
  const writer = createFirestoreChangeWriter({ FieldValue, FieldPath });

  let authenticatedUid = null;
  let currentDocRef = null;
  let unsubscribe = null;

  const sequencer = createUserDocSequencer({
    planAction: ({ modify, userDoc }) =>
      planChange({ JSONPointer, ModifyData, modify, userDoc, language }),
    submitWrite: ({ plan }) => writer.submit({ docRef: currentDocRef, plan }),
    readCache: () => {
      if (!currentDocRef) {
        return Promise.reject(new Error('No active user document.'));
      }
      return currentDocRef.get({ source: 'cache' }).then((snapshot) => ({
        exists: snapshot.exists,
        data: snapshot.data(),
      }));
    },
    onChangeError: sendChangeError,
  });

  const clearListener = () => {
    if (unsubscribe) {
      const stopListening = unsubscribe;
      unsubscribe = null;
      stopListening();
    }
    currentDocRef = null;
  };

  const setUser = (user) => {
    const nextUid = user ? user.uid : null;
    const uidChanged = nextUid !== authenticatedUid;
    if (!uidChanged && (nextUid === null || unsubscribe !== null)) {
      return;
    }

    clearListener();
    if (uidChanged) {
      authenticatedUid = nextUid;
      sequencer.setUid(nextUid);
    }

    if (!nextUid) {
      return;
    }

    currentDocRef = firestore.collection('users').doc(nextUid);
    unsubscribe = currentDocRef.onSnapshot(
      { includeMetadataChanges: true },
      (snapshot) => {
        sequencer.handleSnapshot({
          uid: nextUid,
          exists: snapshot.exists,
          fromCache: snapshot.metadata.fromCache,
          getData: () => snapshot.data(),
        });
      },
      (error) => {
        if (authenticatedUid !== nextUid) {
          return;
        }
        // eslint-disable-next-line no-console
        console.error('Change runtime listener error:', error);
        clearListener();
        sequencer.handleListenerFailure({ uid: nextUid });
        sendChangeError(
          (error && error.code) || 'change/listener-failed',
          (error && error.message) || String(error),
        );
      },
    );
  };

  return {
    setUser,
    enqueue: ({ uid, modify }) => {
      // A live UID with no docRef means the listener failed and is awaiting an
      // ID-token refresh; drop the action loudly rather than stall it forever.
      if (uid === authenticatedUid && !currentDocRef) {
        sendChangeError(
          'change/listener-unavailable',
          'Change action dropped: the user document listener is unavailable.',
        );
        return;
      }
      sequencer.enqueue({ uid, modify });
    },
    dispose: () => {
      clearListener();
      sequencer.dispose();
    },
  };
};
