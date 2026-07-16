import _ from 'lodash';

import PandaBridge from 'pandasuite-bridge';
import { usePandaBridge } from 'pandasuite-bridge-react';

import app from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
// import { setLogLevel } from 'firebase/app';
import { useMemo, useEffect, useCallback, useRef } from 'react';

import { JSONPointer, ModifyData } from '@beingenious/jsonpointer';
import { initializeFirebase } from './firebaseConfig';
import { generateAuthTokenAction } from './generateAuthTokenAction.mjs';
import {
  completeEmailLinkSignInAction,
  requestEmailLinkSignInAction,
} from './emailLinkSignInActions.mjs';
import { normalizeCollectionsForStorage } from './collectionStorageAdapter.mjs';
import {
  createChangeActionController,
  subscribeToChangeAuth,
} from './changeActionController.mjs';
import { createChangeRuntime } from './createChangeRuntime.mjs';

let firestore = null;
let auth = null;

// setLogLevel('debug');

function useFirebaseWithBridge() {
  const sendChangeError = useCallback((code, message) => {
    PandaBridge.send('onChangeError', [{ code, message }]);
  }, []);
  const changeRuntimeRef = useRef(null);
  const changeActionController = useMemo(
    () =>
      createChangeActionController({
        applyChange: ({ user, modify }) => {
          changeRuntimeRef.current?.enqueue({ uid: user.uid, modify });
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
      requestEmailLinkSignIn: ({ email, continueUrl }) => {
        requestEmailLinkSignInAction({
          auth,
          email,
          continueUrl,
          send: PandaBridge.send.bind(PandaBridge),
        });
      },
      completeEmailLinkSignIn: ({ email, emailLink }) => {
        completeEmailLinkSignInAction({
          auth,
          firestore,
          email,
          emailLink,
          defaultUserSchema: getDefaultUserSchema(),
          send: PandaBridge.send.bind(PandaBridge),
        });
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

  const changeRuntime = useMemo(() => {
    if (!firestore) {
      return null;
    }
    return createChangeRuntime({
      firestore,
      FieldValue: app.firestore.FieldValue,
      FieldPath: app.firestore.FieldPath,
      JSONPointer,
      ModifyData,
      sendChangeError,
      language: navigator.language.replace('-', '_'),
    });
  }, [firestore, sendChangeError]);

  useEffect(() => {
    changeRuntimeRef.current = changeRuntime;
    return () => {
      if (changeRuntime) {
        changeRuntime.dispose();
      }
      if (changeRuntimeRef.current === changeRuntime) {
        changeRuntimeRef.current = null;
      }
    };
  }, [changeRuntime]);

  useEffect(
    () =>
      subscribeToChangeAuth({
        auth,
        setUser: (user) => changeRuntimeRef.current?.setUser(user),
        syncAuth: changeActionController.syncAuth,
      }),
    [auth, changeActionController, changeRuntime],
  );

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
