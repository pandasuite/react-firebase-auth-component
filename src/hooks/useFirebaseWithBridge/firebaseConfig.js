import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import isEqual from 'lodash/isEqual';
import cloneDeep from 'lodash/cloneDeep';

let firebaseApp = null;
let auth = null;
let firestore = null;
let currentConfig = null;

/**
 * Initializes Firebase with the given configuration.
 * If Firebase is already initialized with the same config, it returns existing instances.
 * Otherwise, it initializes a new Firebase app.
 *
 * @param {Object} config - Firebase configuration object.
 * @returns {Object} - { auth, firestore }
 */
const initializeFirebase = (config) => {
  // If Firebase is already initialized with the same config, return existing instances
  if (firebaseApp && isEqual(currentConfig, config)) {
    return { auth, firestore };
  }

  // If Firebase is initialized with a different config, delete the existing app
  if (firebaseApp) {
    try {
      firebaseApp.delete();
    } catch (error) {
      console.error('Error deleting existing Firebase app:', error);
    }
    firebaseApp = null;
    auth = null;
    firestore = null;
  }

  try {
    // Initialize Firebase app
    firebaseApp = firebase.initializeApp(config);
    auth = firebaseApp.auth();
    firestore = firebaseApp.firestore();

    // Enable Firestore persistence asynchronously
    firestore
      .enablePersistence({ synchronizeTabs: true })
      .then(() => {
        console.log('Firestore persistence enabled');
      })
      .catch((error) => {
        console.error('Error enabling Firestore persistence:', error);
      });
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    throw error;
  }

  // Clone the config to prevent mutations
  currentConfig = cloneDeep(config);
  return { auth, firestore };
};

/**
 * Retrieves the current Firebase auth and firestore instances.
 *
 * @returns {Object} - { auth, firestore }
 * @throws {Error} - If Firebase has not been initialized.
 */
const getFirebaseInstances = () => {
  if (!firebaseApp) {
    throw new Error('Firebase has not been initialized.');
  }
  return { auth, firestore };
};

export { initializeFirebase, getFirebaseInstances };
