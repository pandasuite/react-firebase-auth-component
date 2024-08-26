import React, { useContext, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useHistory } from 'react-router-dom';
import { Header, Button, Card, Alert } from 'tabler-react';
import PandaBridge from 'pandasuite-bridge';

import * as ROUTES from '../../constants/routes';
import StandaloneFormPage from '../StandaloneFormPage';
import FirebaseBridgeContext from '../../FirebaseBridgeContext';

const VerifyEmail = () => {
  const firebaseWithBridge = useContext(FirebaseBridgeContext);
  const intl = useIntl();
  const history = useHistory();
  const [state, setState] = useState({
    retryInProgress: false,
    resendInProgress: false,
    error: false,
  });

  const { auth, firestore } = firebaseWithBridge || {};
  const { currentUser } = auth || {};

  useEffect(() => {
    if (!currentUser) {
      return undefined;
    }

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
  }, [currentUser, firestore]);

  const onRetryClick = () => {
    setState((prev) => ({ ...prev, error: false, retryInProgress: true }));
    if (currentUser) {
      currentUser
        .reload()
        .then(() => {
          const { emailVerified } = auth.currentUser;

          setState((prev) => ({ ...prev, retryInProgress: false }));
          if (emailVerified) {
            PandaBridge.send('onEmailVerified');
            history.push(ROUTES.HOME);
          }
        })
        .catch((e) => {
          setState((prev) => ({ ...prev, retryInProgress: false, error: e }));
        });
    }
  };

  const onResendClick = () => {
    setState((prev) => ({ ...prev, error: false, resendInProgress: true }));
    if (currentUser) {
      currentUser
        .sendEmailVerification()
        .then(() => {
          setState((prev) => ({ ...prev, resendInProgress: false }));
        })
        .catch((e) => {
          setState((prev) => ({ ...prev, resendInProgress: false, error: e }));
        });
    }
  };

  return (
    <StandaloneFormPage>
      <Card>
        <Card.Body>
          <Header.H4>
            {intl.formatMessage({ id: 'page.verifyemail.alert.title' })}
          </Header.H4>
          <p>
            {intl.formatMessage({ id: 'page.verifyemail.alert.body' })}
            <b>{`${(currentUser || {}).email}.`}</b>
          </p>
          {state && state.error && (
            <Alert type="danger" className="mt-6" isDismissible>
              {state.error.message}
            </Alert>
          )}
          <Button.List>
            <Button
              loading={state.retryInProgress}
              color="success"
              RootComponent="button"
              onClick={onRetryClick}
            >
              {intl.formatMessage({
                id: 'page.verifyemail.alert.button.retry',
              })}
            </Button>
            <Button
              loading={state.resendInProgress}
              color="secondary"
              RootComponent="button"
              onClick={onResendClick}
            >
              {intl.formatMessage({
                id: 'page.verifyemail.alert.button.resend',
              })}
            </Button>
          </Button.List>
          <div className="row row gutters-xs align-items-center mt-5">
            <div className="col col-auto">
              {intl.formatMessage({
                id: 'page.verifyemail.form.signout.label',
              })}
            </div>
            <Button
              link
              className="p-0"
              href="#"
              onClick={() => {
                auth.signOut();
              }}
            >
              {intl.formatMessage({
                id: 'page.verifyemail.form.signout.action',
              })}
            </Button>
          </div>
        </Card.Body>
      </Card>
    </StandaloneFormPage>
  );
};

export default VerifyEmail;
