import _ from 'lodash';

import PandaBridge from 'pandasuite-bridge';
import { usePandaBridge } from 'pandasuite-bridge-react';

import app from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
// import { setLogLevel } from 'firebase/app';
import { useMemo, useEffect, useCallback } from 'react';

import { JSONPointer, ModifyData } from '@beingenious/jsonpointer';
import { initializeFirebase } from './firebaseConfig';
import { generateAuthTokenAction } from './generateAuthTokenAction.mjs';
import { normalizeCollectionsForStorage } from './collectionStorageAdapter.mjs';
import {
  buildUserDocUpdate,
  REPLACE_DOCUMENT_UPDATE,
} from './modifyDataAdapter.mjs';
import { createChangeActionController } from './changeActionController.mjs';

let firestore = null;
let auth = null;

// setLogLevel('debug');

const changeData = ({ user, modify }) => {
  const userDocRef = firestore.collection('users').doc(user.uid);

  firestore
    .runTransaction((transaction) =>
      transaction.get(userDocRef).then((userDoc) => {
        if (userDoc.exists) {
          const userData = userDoc.data();

          const update = buildUserDocUpdate({
            JSONPointer,
            ModifyData,
            userData,
            modify,
            FieldValue: app.firestore.FieldValue,
            language: navigator.language.replace('-', '_'),
          });
          if (update) {
            if (
              Object.prototype.hasOwnProperty.call(
                update,
                REPLACE_DOCUMENT_UPDATE,
              )
            ) {
              transaction.set(userDocRef, update[REPLACE_DOCUMENT_UPDATE]);
            } else {
              transaction.update(userDocRef, update);
            }
          }
        }
      }),
    )
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.log(error);
      PandaBridge.send('onChangeError', [
        {
          code: (error && error.code) || 'unknown',
          message: (error && error.message) || String(error),
        },
      ]);
    });
};

function useFirebaseWithBridge() {
  const sendChangeError = useCallback((code, message) => {
    PandaBridge.send('onChangeError', [{ code, message }]);
  }, []);
  const changeActionController = useMemo(
    () =>
      createChangeActionController({
        applyChange: ({ user, modify }) => {
          changeData({ user, modify });
        },
        sendChangeError,
      }),
    [sendChangeError],
  );

  const { properties } = usePandaBridge({
    actions: {
      signOut: () => {
        if (auth) {
          auth.signOut();
        }
      },
      signInWithCustomToken: ({ token }) => {
        if (auth && token) {
          auth.signInWithCustomToken(token).catch((error) => {
            PandaBridge.send('onSignInError', [
              {
                code: error.code,
                message: error.message,
              },
            ]);
          });
        }
      },
      signInWithEmailAndPassword: ({ email, password }) => {
        if (auth && email && password) {
          auth.signInWithEmailAndPassword(email, password).catch((error) => {
            PandaBridge.send('onSignInError', [
              {
                code: error.code,
                message: error.message,
              },
            ]);
          });
        }
      },
      generateAuthToken: ({ forceRefresh }) => {
        generateAuthTokenAction({
          auth,
          forceRefresh,
          send: PandaBridge.send.bind(PandaBridge),
        });
      },
      change: (payload) => {
        changeActionController.handleIncomingChange({ payload, auth });
      },
      registerWithEmailAndPassword: ({ email, password, traits }) => {
        if (auth && email && password) {
          auth
            .createUserWithEmailAndPassword(email, password)
            .then((cred) => {
              if (firestore) {
                firestore
                  .collection('users')
                  .doc(cred.user.uid)
                  .set(
                    _.merge({}, getDefaultUserSchema(), {
                      email,
                      ...(traits || {}),
                    }),
                    { merge: true },
                  );
              }
            })
            .catch((error) => {
              PandaBridge.send('onRegisterError', [
                {
                  code: error.code,
                  message: error.message,
                },
              ]);
            });
        }
      },
    },
  });

  const mergedProperties = useMemo(
    () => _.merge({}, properties, properties?.session?.properties),
    [properties],
  );

  const getDefaultUserSchema = useCallback(
    () =>
      normalizeCollectionsForStorage(
        _.cloneDeep(mergedProperties?.defaultUserSchema || {}),
      ),
    [mergedProperties],
  );

  [auth, firestore] = useMemo(() => {
    const hasFirebaseConfig =
      mergedProperties && mergedProperties.apiKey && mergedProperties.projectId;

    if (!hasFirebaseConfig) {
      return PandaBridge.isStudio ? [false] : [null];
    }

    try {
      const initializedApp = initializeFirebase({
        apiKey: mergedProperties.apiKey,
        authDomain: mergedProperties.authDomain,
        databaseURL: mergedProperties.databaseURL,
        projectId: mergedProperties.projectId,
        storageBucket: mergedProperties.storageBucket,
        messagingSenderId: mergedProperties.messagingSenderId,
        appId: mergedProperties.appId,
      });

      return [initializedApp.auth, initializedApp.firestore];
    } catch (error) {
      console.error(error);
      return [false];
    }
  }, [mergedProperties]);

  useEffect(() => {
    if (
      auth === false ||
      auth === null ||
      typeof auth?.onAuthStateChanged !== 'function'
    ) {
      changeActionController.syncAuth(auth);
      return undefined;
    }

    changeActionController.syncAuth(auth);

    const unsubscribe = auth.onAuthStateChanged((user) => {
      changeActionController.syncAuth({ currentUser: user });
    });

    return () => unsubscribe();
  }, [auth, changeActionController]);

  useEffect(
    () => () => {
      changeActionController.dispose();
    },
    [changeActionController],
  );

  useEffect(() => {
    if (!firestore || firestore === false) {
      return undefined;
    }

    let isProcessing = false;

    const handleAppState = async (args) => {
      const { state } = args?.[0] || {};

      if (state === 'foreground' && !isProcessing) {
        isProcessing = true;
        try {
          await firestore.disableNetwork();
          await firestore.enableNetwork();
        } catch (error) {
          console.error('Error cycling Firestore network:', error);
        } finally {
          isProcessing = false;
        }
      }
    };

    PandaBridge.listen(PandaBridge.APP_STATE, handleAppState);

    return () => {
      PandaBridge.unlisten(PandaBridge.APP_STATE, handleAppState);
    };
  }, [firestore]);

  if (auth === null) {
    return null; /* Loading */
  }

  if (auth === false) {
    return { auth, bridge: { properties } };
  }

  return { auth, firestore, bridge: { properties } };
}

export default useFirebaseWithBridge;
