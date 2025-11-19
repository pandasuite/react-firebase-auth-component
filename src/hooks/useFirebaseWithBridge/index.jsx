/* eslint-disable radix */
import _ from 'lodash';

import PandaBridge from 'pandasuite-bridge';
import { usePandaBridge } from 'pandasuite-bridge-react';

import app from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
// import { setLogLevel } from 'firebase/app';
import { useMemo, useEffect, useCallback } from 'react';

import JSONPointer from '@beingenious/jsonpointer';
import { initializeFirebase } from './firebaseConfig';

let firestore = null;
let auth = null;

// setLogLevel('debug');

const getPointer = (schema, pointer) => {
  let resolvedPointer = [];

  const value = JSONPointer.resolvePointer(
    schema,
    JSONPointer.getPointerByJSONPointer(pointer),
    {
      unitPool: {
        language: navigator.language.replace('-', '_'),
      },
    },
    undefined,
    undefined,
    resolvedPointer,
  );

  if (!value) {
    resolvedPointer = _.compact(pointer.replace(/@[^:]+:/g, '').split('/'));
  }
  return resolvedPointer;
};

const getDocumentFromPointer = (userData, pointer, value) => {
  const update = {};
  const index = _.findIndex(pointer, (key) => _.isNumber(key));

  if (index !== -1) {
    const path = pointer.slice(0, index).join('.');

    update[path] = _.get(userData, path);
    _.set(update[path], pointer.slice(index).join('.'), value);
  } else {
    update[pointer.join('.')] = value;
  }
  return update;
};

const changeData = ({ user, data, func, value }) => {
  const userDocRef = firestore.collection('users').doc(user.uid);

  firestore
    .runTransaction((transaction) =>
      transaction.get(userDocRef).then((userDoc) => {
        if (userDoc.exists) {
          const userData = userDoc.data();
          const pointer = getPointer(userData, data);

          let fieldValue = value;

          if (func === 'inc') {
            fieldValue = app.firestore.FieldValue.increment(parseInt(value));
          } else if (func === 'dec') {
            fieldValue = app.firestore.FieldValue.increment(-parseInt(value));
          } else if (func === 'del') {
            fieldValue = app.firestore.FieldValue.delete();
          } else if (func === 'add') {
            fieldValue = app.firestore.FieldValue.arrayUnion(value);
          } else if (func === 'delbyid') {
            const doc = _.find(
              _.get(userData, pointer.join('.')),
              (row) => row.id === value,
            );
            if (!doc) {
              return;
            }
            fieldValue = app.firestore.FieldValue.arrayRemove(doc);
          } else if (func === 'delbyvalue') {
            fieldValue = app.firestore.FieldValue.arrayRemove(value);
          }
          transaction.update(
            userDocRef,
            getDocumentFromPointer(userData, pointer, fieldValue),
          );
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
        const { currentUser } = auth;

        if (auth && currentUser) {
          currentUser
            .getIdToken(forceRefresh)
            .then((token) => {
              // Decode the token to get the expiration time
              const tokenParts = token.split('.');
              if (tokenParts.length === 3) {
                try {
                  const payload = JSON.parse(atob(tokenParts[1]));
                  const expiresAt = {
                    type: 'Date',
                    value: payload.exp,
                  };

                  // Trigger the event with the token and expiration
                  PandaBridge.send('onAuthTokenGenerated', [
                    {
                      token,
                      expiresAt,
                    },
                  ]);
                } catch (error) {
                  console.error('Error decoding token:', error);
                }
              }
            })
            .catch((error) => {
              console.error('Error generating auth token:', error);
            });
        }
      },
      change: ({ data, function: func, value }) => {
        const { currentUser } = auth;

        if (currentUser) {
          changeData({
            user: currentUser,
            data,
            func,
            value,
          });
        } else {
          const unsubscribe = auth.onAuthStateChanged((user) => {
            if (user) {
              unsubscribe();
              changeData({
                user,
                data,
                func,
                value,
              });
            }
          });
        }
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
    () => _.cloneDeep(mergedProperties?.defaultUserSchema || {}),
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
