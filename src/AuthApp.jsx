import React, { useEffect } from 'react';
import { HashRouter as Router, Route, Switch } from 'react-router-dom';
import PandaBridge from 'pandasuite-bridge';

import HandleStatePage from './pages/HandleState';
import SignUpPage from './pages/SignUp';
import SignInPage from './pages/SignIn';
import PasswordForgetPage from './pages/PasswordForget';
import VerifyEmailPage from './pages/VerifyEmail';
import HomePage from './pages/Home';
import InvalidPage from './pages/Invalid';
import * as ROUTES from './constants/routes';
import IntlProvider from './IntlProvider';
import FirebaseBridgeContext from './FirebaseBridgeContext';
import useFirebaseWithBridge from './hooks/useFirebaseWithBridge';
import 'tabler-react/dist/Tabler.css';
import './AuthApp.css';

function AuthApp() {
  const firebaseWithBridge = useFirebaseWithBridge();
  const { bridge } = firebaseWithBridge || {};
  const { properties } = bridge || {};
  const { styles, [PandaBridge.LANGUAGE]: language } = properties || {};

  useEffect(() => {
    if (!styles) {
      return undefined;
    }
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
    return () => style.remove();
  }, [styles]);

  return (
    <FirebaseBridgeContext.Provider value={firebaseWithBridge}>
      <IntlProvider language={language}>
        <Router>
          <Switch>
            <Route exact path={ROUTES.SIGN_UP} component={SignUpPage} />
            <Route exact path={ROUTES.SIGN_IN} component={SignInPage} />
            <Route
              exact
              path={`${ROUTES.PASSWORD_FORGET}/:email?`}
              component={PasswordForgetPage}
            />
            <Route
              exact
              path={ROUTES.VERIFY_EMAIL}
              component={VerifyEmailPage}
            />
            <Route exact path={ROUTES.HOME} component={HomePage} />
            <Route
              exact
              path={ROUTES.INVALID_CONFIGURATION}
              component={InvalidPage}
            />
          </Switch>
          <HandleStatePage />
        </Router>
      </IntlProvider>
    </FirebaseBridgeContext.Provider>
  );
}

export default AuthApp;
