import 'react-app-polyfill/ie9';
import 'react-app-polyfill/stable';
import 'pandasuite-bridge';

import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { PandaBridgeRoot } from 'pandasuite-bridge-react';
import './App.css';
import AuthApp from './AuthApp';

createRoot(document.getElementById('root')).render(
  <PandaBridgeRoot>
    <Suspense fallback={null}>
      <AuthApp />
    </Suspense>
  </PandaBridgeRoot>,
);
