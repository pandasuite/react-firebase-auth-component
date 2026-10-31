import 'react-app-polyfill/ie9';
import 'react-app-polyfill/stable';
import PandaBridge from 'pandasuite-bridge';

import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { PandaBridgeRoot } from 'pandasuite-bridge-react';
import './App.css';
import SessionApp from './SessionApp';

PandaBridge.followStudioTheme();

createRoot(document.getElementById('root')).render(
  <PandaBridgeRoot>
    <Suspense fallback={null}>
      <SessionApp />
    </Suspense>
  </PandaBridgeRoot>,
);
