import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completeEmailLinkSignInAction,
  requestEmailLinkSignInAction,
  toEmailLinkActionCodeSettings,
} from '../src/hooks/useFirebaseWithBridge/emailLinkSignInActions.mjs';

test('toEmailLinkActionCodeSettings returns null when continueUrl is missing', () => {
  assert.equal(toEmailLinkActionCodeSettings({}), null);
});

test('toEmailLinkActionCodeSettings builds minimal settings with handleCodeInApp', () => {
  assert.deepEqual(
    toEmailLinkActionCodeSettings({
      continueUrl: 'https://example.com/finish',
    }),
    {
      url: 'https://example.com/finish',
      handleCodeInApp: true,
    },
  );
});

test('toEmailLinkActionCodeSettings includes an optional link domain', () => {
  assert.deepEqual(
    toEmailLinkActionCodeSettings({
      continueUrl: 'https://example.com/finish',
      linkDomain: 'links.example.com',
    }),
    {
      url: 'https://example.com/finish',
      handleCodeInApp: true,
      linkDomain: 'links.example.com',
    },
  );
});

test('requestEmailLinkSignInAction sends request success event on success', async () => {
  const sent = [];
  const auth = {
    sendSignInLinkToEmail: async (...args) => {
      assert.deepEqual(args, [
        'ben@example.com',
        {
          url: 'https://example.com/finish',
          handleCodeInApp: true,
        },
      ]);
    },
  };

  const result = await requestEmailLinkSignInAction({
    auth,
    email: 'ben@example.com',
    continueUrl: 'https://example.com/finish',
    send: (event, payload) => sent.push({ event, payload }),
  });

  assert.equal(result, true);
  assert.deepEqual(sent, [
    {
      event: 'onEmailLinkRequested',
      payload: [],
    },
  ]);
});

test('requestEmailLinkSignInAction emits request error event when Firebase rejects the request', async () => {
  const sent = [];
  const auth = {
    sendSignInLinkToEmail: async () => {
      throw {
        code: 'auth/invalid-email',
        message: 'Email is invalid.',
      };
    },
  };

  const result = await requestEmailLinkSignInAction({
    auth,
    email: 'bad-email',
    continueUrl: 'https://example.com/finish',
    send: (event, payload) => sent.push({ event, payload }),
    onError: () => {},
  });

  assert.equal(result, false);
  assert.deepEqual(sent, [
    {
      event: 'onEmailLinkRequestError',
      payload: [
        {
          code: 'auth/invalid-email',
          message: 'Unable to request an email-link sign-in.',
        },
      ],
    },
  ]);
});

test('requestEmailLinkSignInAction emits a missing-continue-uri error when continueUrl is absent', async () => {
  const sent = [];
  const auth = {
    sendSignInLinkToEmail: async () => {
      throw new Error('should not be called');
    },
  };

  const result = await requestEmailLinkSignInAction({
    auth,
    email: 'ben@example.com',
    send: (event, payload) => sent.push({ event, payload }),
    onError: () => {},
  });

  assert.equal(result, false);
  assert.deepEqual(sent, [
    {
      event: 'onEmailLinkRequestError',
      payload: [
        {
          code: 'auth/missing-continue-uri',
          message:
            'Cannot request an email-link sign-in without a continue URL.',
        },
      ],
    },
  ]);
});

test('completeEmailLinkSignInAction completes sign-in and ensures the user document', async () => {
  const calls = [];
  const auth = {
    signInWithEmailLink: async (email, emailLink) => {
      calls.push({ type: 'signIn', email, emailLink });
      return {
        user: {
          uid: 'user-123',
        },
      };
    },
  };
  const firestore = {
    collection: (name) => ({
      doc: (uid) => ({
        set: async (data, options) => {
          calls.push({ type: 'set', name, uid, data, options });
        },
      }),
    }),
  };

  const result = await completeEmailLinkSignInAction({
    auth,
    firestore,
    email: 'ben@example.com',
    emailLink:
      'https://project.firebaseapp.com/__/auth/action?mode=signIn&oobCode=abc',
    defaultUserSchema: { role: 'member' },
    send: () => {},
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [
    {
      type: 'signIn',
      email: 'ben@example.com',
      emailLink:
        'https://project.firebaseapp.com/__/auth/action?mode=signIn&oobCode=abc',
    },
    {
      type: 'set',
      name: 'users',
      uid: 'user-123',
      data: {
        role: 'member',
        email: 'ben@example.com',
      },
      options: { merge: true },
    },
  ]);
});

test('completeEmailLinkSignInAction emits sign-in error when completion fails', async () => {
  const sent = [];
  const auth = {
    signInWithEmailLink: async () => {
      throw {
        code: 'auth/expired-action-code',
        message: 'The link has expired.',
      };
    },
  };

  const result = await completeEmailLinkSignInAction({
    auth,
    firestore: null,
    email: 'ben@example.com',
    emailLink:
      'https://project.firebaseapp.com/__/auth/action?mode=signIn&oobCode=abc',
    defaultUserSchema: {},
    send: (event, payload) => sent.push({ event, payload }),
    onError: () => {},
  });

  assert.equal(result, false);
  assert.deepEqual(sent, [
    {
      event: 'onSignInError',
      payload: [
        {
          code: 'auth/expired-action-code',
          message: 'Unable to complete email-link sign-in.',
        },
      ],
    },
  ]);
});

test('completeEmailLinkSignInAction reports user-document write failures through onChangeError without cancelling sign-in', async () => {
  const sent = [];
  const auth = {
    signInWithEmailLink: async () => ({
      user: {
        uid: 'user-123',
      },
    }),
  };
  const firestore = {
    collection: () => ({
      doc: () => ({
        set: async () => {
          throw {
            code: 'permission-denied',
            message: 'No permission.',
          };
        },
      }),
    }),
  };

  const result = await completeEmailLinkSignInAction({
    auth,
    firestore,
    email: 'ben@example.com',
    emailLink:
      'https://project.firebaseapp.com/__/auth/action?mode=signIn&oobCode=abc',
    defaultUserSchema: {},
    send: (event, payload) => sent.push({ event, payload }),
    onError: () => {},
  });

  assert.equal(result, true);
  assert.deepEqual(sent, [
    {
      event: 'onChangeError',
      payload: [
        {
          code: 'permission-denied',
          message: 'Failed to ensure the signed-in user profile document.',
        },
      ],
    },
  ]);
});
