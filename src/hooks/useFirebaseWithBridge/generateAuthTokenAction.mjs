import { toAuthTokenGeneratedPayload } from './authTokenAdapter.mjs';

export const generateAuthTokenAction = async ({
  auth,
  forceRefresh,
  send,
  onError = console.error,
}) => {
  const currentUser = auth?.currentUser;
  if (!currentUser || typeof currentUser.getIdTokenResult !== 'function') {
    return false;
  }

  try {
    const tokenResult = await currentUser.getIdTokenResult(forceRefresh);
    const payload = toAuthTokenGeneratedPayload(tokenResult);

    if (!payload) {
      onError('Error generating auth token: missing expiration data.');
      return false;
    }

    send('onAuthTokenGenerated', [payload]);
    return true;
  } catch (error) {
    onError('Error generating auth token:', error);
    return false;
  }
};
