import { useContext, useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import PandaBridge from 'pandasuite-bridge';

import * as ROUTES from '../../constants/routes';
import FirebaseBridgeContext from '../../FirebaseBridgeContext';

function HandleStatePage() {
  const history = useHistory();
  const firebaseWithBridge = useContext(FirebaseBridgeContext);

  useEffect(() => {
    if (firebaseWithBridge === null) {
      return;
    }

    const { auth, bridge } = firebaseWithBridge;

    if (auth === false) {
      history.replace(ROUTES.INVALID_CONFIGURATION);
      return;
    }

    const safePush = (path) => {
      if (history.location.pathname !== path) {
        history.push(path);
      }
    };

    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        const { properties } = bridge || {};
        const requiresEmailVerification =
          properties.verifyEmail === true ||
          properties.session?.properties?.verifyEmail === true;

        if (requiresEmailVerification && !user.emailVerified) {
          safePush(ROUTES.VERIFY_EMAIL);
          return;
        }

        if (properties.forceAuthenticationAfter > 0) {
          const { metadata } = user;
          const hoursSinceTheLastSignIn =
            (Date.now() - Date.parse(metadata.lastSignInTime)) / 1000 / 60 / 60;

          if (hoursSinceTheLastSignIn > properties.forceAuthenticationAfter) {
            user
              .reload()
              .then(() => {
                safePush(ROUTES.HOME);
              })
              .catch((e) => {
                if (e && e.code === 'auth/network-request-failed') {
                  const once = () => {
                    window.removeEventListener('online', once);
                    user
                      .reload()
                      .then(() => safePush(ROUTES.HOME))
                      .catch(() => {});
                  };
                  window.addEventListener('online', once, {
                    once: true,
                  });
                  safePush(ROUTES.HOME);
                } else {
                  auth.signOut();
                }
              });
            return;
          }
        }
        safePush(ROUTES.HOME);
      } else {
        PandaBridge.send(PandaBridge.UPDATED, {
          queryable: {},
        });
        PandaBridge.send('onSignedOut');
        if (
          history.location.pathname !== ROUTES.SIGN_IN &&
          history.location.pathname !== ROUTES.SIGN_UP &&
          !history.location.pathname.startsWith(ROUTES.PASSWORD_FORGET)
        ) {
          safePush(ROUTES.SIGN_IN);
        }
      }
    });

    return () => unsubscribe();
  }, [firebaseWithBridge, history]);

  return null;
}

export default HandleStatePage;
