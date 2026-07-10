import React, { useContext, useEffect } from 'react';
import PandaBridge from 'pandasuite-bridge';

import FirebaseBridgeContext from '../../FirebaseBridgeContext';
import { toQueryableShape } from '../../hooks/useFirebaseWithBridge/collectionStorageAdapter.mjs';

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

    const unsubscribe =
      currentUser &&
      firestore
        .collection('users')
        .doc(currentUser.uid)
        .onSnapshot(
          (snapshot) => {
            const data = toQueryableShape(snapshot.data() || {});

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
