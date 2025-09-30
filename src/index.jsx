import 'react-app-polyfill/ie9';
import 'react-app-polyfill/stable';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { PandaBridgeRoot } from 'pandasuite-bridge-react';
import './index.css';
import App from './App';

const root = createRoot(document.getElementById('root'));
root.render(
  <PandaBridgeRoot>
    <App />
  </PandaBridgeRoot>,
);
