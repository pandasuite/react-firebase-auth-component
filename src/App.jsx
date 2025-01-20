import React from 'react';
import { HashRouter as Router, Route, Switch } from 'react-router-dom';
import PandaBridge from 'pandasuite-bridge';

import IntlProvider from './IntlProvider';
import FirebaseBridgeContext from './FirebaseBridgeContext';
import useFirebaseWithBridge from './hooks/useFirebaseWithBridge';

import * as ROUTES from './constants/routes';
import HandleStatePage from './pages/HandleState';
import SignUpPage from './pages/SignUp';
import SignInPage from './pages/SignIn';
import PasswordForgetPage from './pages/PasswordForget';
import VerifyEmailPage from './pages/VerifyEmail';
import HomePage from './pages/Home';
import InvalidPage from './pages/Invalid';

import 'tabler-react/dist/Tabler.css';
import './App.css';

function App() {
  const firebaseWithBridge = useFirebaseWithBridge();
  const { bridge } = firebaseWithBridge || {};
  const { properties } = bridge || {};
  const { styles, [PandaBridge.LANGUAGE]: language } = properties || {};

  if (styles) {
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.append(style);
  }
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

export default App;
