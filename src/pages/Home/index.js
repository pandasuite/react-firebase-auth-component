import React, { useContext, useEffect } from 'react';
import PandaBridge from 'pandasuite-bridge';

import { deleteDB, openDB } from 'idb';
import { find } from 'lodash';

import FirebaseBridgeContext from '../../FirebaseBridgeContext';

async function fixIndexDbBug() {
  if (!window.indexedDB) {
    return;
  }
  const databases = await window.indexedDB.databases();
  const firestoreDb = find(databases, (db) => db.name.startsWith('firestore/'));

  if (!firestoreDb) {
    return;
  }

  const timeOut = setTimeout(async () => {
    console.log('IndexedDB Safari Bug...', firestoreDb.name);
    await deleteDB(firestoreDb.name);
  }, 200);

  const db = await openDB(firestoreDb.name);
  await db.getAll('owner');
  clearTimeout(timeOut);
  db.close();
}

const Home = () => {
  const firebaseWithBridge = useContext(FirebaseBridgeContext);
  const { firestore, auth, bridge } = firebaseWithBridge || {};
  const { properties: { apiKey: isSession } = {} } = bridge || {};

  const currentUser = auth && auth.currentUser;

  useEffect(() => {
    let signedInTrigger = false;

    if (!isSession || !currentUser) {
      return undefined;
    }

    fixIndexDbBug();

    const unsubscribe =
      currentUser &&
      firestore
        .collection('users')
        .doc(currentUser.uid)
        .onSnapshot(
          (snapshot) => {
            const data = snapshot.data();

            PandaBridge.send(PandaBridge.UPDATED, {
              queryable: { ...data, id: currentUser.uid },
            });

            if (signedInTrigger === false) {
              PandaBridge.send('onSignedIn');
              signedInTrigger = true;
            }
          },
          (error) => {
            console.log(error);
          },
        );

    return function cleanup() {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [currentUser, firestore, isSession]);
  return <></>;
};

export default Home;
