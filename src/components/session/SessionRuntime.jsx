import { useContext, useEffect } from 'react';
import PandaBridge from 'pandasuite-bridge';

import FirebaseBridgeContext from '../../FirebaseBridgeContext';
import { toQueryableShape } from '../../hooks/useFirebaseWithBridge/collectionStorageAdapter.mjs';

function SessionRuntime() {
  const firebaseWithBridge = useContext(FirebaseBridgeContext);
  const { auth, firestore } = firebaseWithBridge || {};

  useEffect(() => {
    if (!auth || !firestore) {
      if (auth === false) {
        // In studio mode, SessionSetup handles the queryable with defaultUserSchema
        if (!PandaBridge.isStudio) {
          PandaBridge.send(PandaBridge.UPDATED, { queryable: {} });
        }
        PandaBridge.send('onSignedOut');
      }
      return undefined;
    }

    let signedInTrigger = false;
    let unsubscribeUserDoc = null;

    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
        unsubscribeUserDoc = null;
      }

      if (!user) {
        signedInTrigger = false;
        // In studio mode, SessionSetup handles the queryable with defaultUserSchema
        if (!PandaBridge.isStudio) {
          PandaBridge.send(PandaBridge.UPDATED, { queryable: {} });
        }
        PandaBridge.send('onSignedOut');
        return;
      }

      unsubscribeUserDoc = firestore
        .collection('users')
        .doc(user.uid)
        .onSnapshot(
          (snapshot) => {
            const data = toQueryableShape(snapshot.data() || {});
            PandaBridge.send(PandaBridge.UPDATED, {
              queryable: { ...data, id: user.uid },
            });

            if (signedInTrigger === false) {
              PandaBridge.send('onSignedIn');
              signedInTrigger = true;
            }
          },
          (error) => {
            console.error(error);
          },
        );
    });

    return () => {
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
      }
      if (typeof unsubscribeAuth === 'function') {
        unsubscribeAuth();
      }
    };
  }, [auth, firestore]);

  return null;
}

export default SessionRuntime;
