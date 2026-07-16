import app from 'firebase/compat/app';
import 'firebase/compat/firestore';

import { JSONPointer, ModifyData } from '@beingenious/jsonpointer';

import { createChangeRuntime } from '../../src/hooks/useFirebaseWithBridge/createChangeRuntime.mjs';

export const PROJECT_ID = 'demo-panda-optimistic';
const HOST = '127.0.0.1';
const PORT = 8080;

let appCount = 0;
const runtimes = new Set();

export const createEmulatorClient = () => {
  appCount += 1;
  const client = app.initializeApp({ projectId: PROJECT_ID }, `client-${appCount}`);
  const firestore = client.firestore();
  firestore.useEmulator(HOST, PORT);
  return {
    app: client,
    firestore,
    FieldValue: app.firestore.FieldValue,
    FieldPath: app.firestore.FieldPath,
  };
};

export const clearEmulatorData = async () => {
  const response = await fetch(
    `http://${HOST}:${PORT}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  if (!response.ok) {
    throw new Error(`Failed to clear emulator data: ${response.status}`);
  }
};

export const deleteAllApps = async () => {
  for (const runtime of runtimes) {
    runtime.dispose();
  }
  runtimes.clear();
  for (const firebaseApp of app.apps) {
    await firebaseApp.delete();
  }
};

export const waitFor = async (predicate, { timeout = 8000, interval = 25 } = {}) => {
  const start = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) {
      return value;
    }
    if (Date.now() - start > timeout) {
      throw new Error('waitFor: condition not met within timeout');
    }
    await new Promise((resolve) => {
      setTimeout(resolve, interval);
    });
  }
};

export const createRuntimeHarness = (uid) => {
  const client = createEmulatorClient();
  const observer = createEmulatorClient();
  client.firestore.runTransaction = () => {
    throw new Error('runTransaction must never be called by the change path');
  };

  const errors = [];
  const runtime = createChangeRuntime({
    firestore: client.firestore,
    FieldValue: client.FieldValue,
    FieldPath: client.FieldPath,
    JSONPointer,
    ModifyData,
    sendChangeError: (code, message) => errors.push({ code, message }),
    language: 'en_US',
  });
  runtimes.add(runtime);
  runtime.setUser({ uid });

  const docRef = client.firestore.collection('users').doc(uid);
  const observerDocRef = observer.firestore.collection('users').doc(uid);
  return {
    client,
    runtime,
    errors,
    docRef,
    change: (modify) => runtime.enqueue({ uid, modify }),
    localDoc: async () => {
      try {
        const snapshot = await docRef.get({ source: 'cache' });
        return snapshot.exists ? snapshot.data() : null;
      } catch (error) {
        if (error?.code === 'unavailable') {
          return null;
        }
        throw error;
      }
    },
    serverDoc: async () => {
      const snapshot = await observerDocRef.get({ source: 'server' });
      return snapshot.exists ? snapshot.data() : null;
    },
  };
};
