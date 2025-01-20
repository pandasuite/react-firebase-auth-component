import 'react-app-polyfill/ie9';
import 'react-app-polyfill/stable';

import React from 'react';
import ReactDOM from 'react-dom';
import { PandaBridgeRoot } from 'pandasuite-bridge-react';
import './index.css';
import App from './App';

ReactDOM.render(
  <PandaBridgeRoot>
    <App />
  </PandaBridgeRoot>,
  document.getElementById('root'),
);
