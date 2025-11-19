import 'react-app-polyfill/ie9';
import 'react-app-polyfill/stable';

import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { PandaBridgeRoot } from 'pandasuite-bridge-react';
import './App.css';

const target = import.meta.env.VITE_APP_TARGET || 'auth';

function mount(App) {
  const root = createRoot(document.getElementById('root'));
  root.render(
    <PandaBridgeRoot>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </PandaBridgeRoot>,
  );
}

if (target === 'session') {
  import('./SessionApp').then(({ default: App }) => mount(App));
} else {
  import('./AuthApp').then(({ default: App }) => mount(App));
}
