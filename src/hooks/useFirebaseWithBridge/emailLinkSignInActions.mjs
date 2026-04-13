import { ensureUserDocument } from './userDocument.mjs';

const toTrimmedString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toErrorPayload = (error) => ({
  code: error?.code || 'unknown',
  message: error?.message || 'An unknown error occurred.',
});

export const toEmailLinkActionCodeSettings = ({
  continueUrl,
  linkDomain,
} = {}) => {
  const resolvedContinueUrl = toTrimmedString(continueUrl);
  if (!resolvedContinueUrl) {
    return null;
  }

  const settings = {
    url: resolvedContinueUrl,
    handleCodeInApp: true,
  };

  const resolvedLinkDomain = toTrimmedString(linkDomain);
  if (resolvedLinkDomain) {
    settings.linkDomain = resolvedLinkDomain;
  }

  return settings;
};

export const requestEmailLinkSignInAction = async ({
  auth,
  email,
  continueUrl,
  linkDomain,
  send,
  onError = console.error,
}) => {
  if (!auth || typeof auth.sendSignInLinkToEmail !== 'function') {
    return false;
  }

  const resolvedEmail = toTrimmedString(email);
  const actionCodeSettings = toEmailLinkActionCodeSettings({
    continueUrl,
    linkDomain,
  });

  if (!resolvedEmail) {
    return false;
  }

  if (!actionCodeSettings) {
    send?.('onEmailLinkRequestError', [
      {
        code: 'auth/missing-continue-uri',
        message: 'Cannot request an email-link sign-in without a continue URL.',
      },
    ]);
    return false;
  }

  try {
    await auth.sendSignInLinkToEmail(resolvedEmail, actionCodeSettings);
    send?.('onEmailLinkRequested', []);
    return true;
  } catch (error) {
    send?.('onEmailLinkRequestError', [
      {
        code: error?.code || 'unknown',
        message: 'Unable to request an email-link sign-in.',
      },
    ]);
    onError('Error requesting email link sign-in:', error);
    return false;
  }
};

export const completeEmailLinkSignInAction = async ({
  auth,
  firestore,
  email,
  emailLink,
  defaultUserSchema = {},
  send,
  onError = console.error,
}) => {
  if (!auth || typeof auth.signInWithEmailLink !== 'function') {
    return false;
  }

  const resolvedEmail = toTrimmedString(email);
  const resolvedEmailLink = toTrimmedString(emailLink);
  if (!resolvedEmail || !resolvedEmailLink) {
    return false;
  }

  try {
    const credential = await auth.signInWithEmailLink(
      resolvedEmail,
      resolvedEmailLink,
    );
    const user = credential?.user;

    if (user?.uid) {
      try {
        await ensureUserDocument({
          firestore,
          uid: user.uid,
          data: {
            ...(defaultUserSchema || {}),
            email: resolvedEmail,
          },
        });
      } catch (error) {
        send?.('onChangeError', [
          {
            code: error?.code || 'unknown',
            message: 'Failed to ensure the signed-in user profile document.',
          },
        ]);
        onError(
          'Error ensuring user document after email link sign-in:',
          error,
        );
      }
    }

    return true;
  } catch (error) {
    send?.('onSignInError', [
      {
        code: error?.code || 'unknown',
        message: 'Unable to complete email-link sign-in.',
      },
    ]);
    onError('Error completing email link sign-in:', error);
    return false;
  }
};
