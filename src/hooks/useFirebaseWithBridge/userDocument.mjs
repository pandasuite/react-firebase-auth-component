const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

export const ensureUserDocument = async ({ firestore, uid, data }) => {
  if (
    !firestore ||
    typeof firestore.collection !== 'function' ||
    !isNonEmptyString(uid) ||
    !data ||
    typeof data !== 'object'
  ) {
    return false;
  }

  await firestore.collection('users').doc(uid).set(data, { merge: true });
  return true;
};
