import { useContext, useEffect } from 'react';
import PandaBridge from 'pandasuite-bridge';
import { deleteDB, openDB } from 'idb';
import { find } from 'lodash';

import FirebaseBridgeContext from '../../FirebaseBridgeContext';

async function fixIndexDbBug() {
  if (
    typeof window === 'undefined' ||
    !window.indexedDB ||
    typeof window.indexedDB.databases !== 'function'
  ) {
    return;
  }

  const databases = await window.indexedDB.databases();
  const firestoreDb = find(databases, (db) =>
    db?.name?.startsWith('firestore/'),
  );

  if (!firestoreDb) {
    return;
  }

  const timeOut = setTimeout(async () => {
    try {
      await deleteDB(firestoreDb.name);
    } catch (error) {
      console.error('IndexedDB cleanup failed', error);
    }
  }, 200);

  try {
    const db = await openDB(firestoreDb.name);
    await db.getAll('owner');
    clearTimeout(timeOut);
    db.close();
  } catch (error) {
    console.error('IndexedDB Safari workaround failed', error);
  }
}

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

      fixIndexDbBug();

      unsubscribeUserDoc = firestore
        .collection('users')
        .doc(user.uid)
        .onSnapshot(
          (snapshot) => {
            const data = snapshot.data() || {};
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
