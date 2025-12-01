import React, { Suspense, lazy, useEffect } from 'react';

import PandaBridge from 'pandasuite-bridge';
import IntlProvider from './IntlProvider';
import FirebaseBridgeContext from './FirebaseBridgeContext';
import useFirebaseWithBridge from './hooks/useFirebaseWithBridge';
import SessionRuntime from './components/session/SessionRuntime';
import './tailwind.css';

const SessionSetup = lazy(() => import('./components/session/SessionSetup'));

function SessionApp() {
  const firebaseWithBridge = useFirebaseWithBridge();
  const { bridge } = firebaseWithBridge || {};
  const { properties } = bridge || {};
  const { styles, [PandaBridge.LANGUAGE]: language } = properties || {};

  const showSessionSetup = PandaBridge.isStudio && properties !== undefined;

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
        <SessionRuntime />
        {showSessionSetup ? (
          <Suspense fallback={null}>
            <SessionSetup />
          </Suspense>
        ) : null}
      </IntlProvider>
    </FirebaseBridgeContext.Provider>
  );
}

export default SessionApp;
