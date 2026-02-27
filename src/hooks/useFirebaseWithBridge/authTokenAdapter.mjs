const toUnixSeconds = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric);
  }

  const millis = Date.parse(value);
  if (Number.isFinite(millis)) {
    return Math.floor(millis / 1000);
  }

  return null;
};

export const toAuthTokenGeneratedPayload = (tokenResult) => {
  if (!tokenResult || typeof tokenResult !== 'object') {
    return null;
  }

  const { token, claims, expirationTime } = tokenResult;
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }

  const expClaim =
    claims && typeof claims === 'object' ? claims.exp : undefined;
  const expiresAtValue =
    toUnixSeconds(expClaim) ?? toUnixSeconds(expirationTime);

  if (expiresAtValue == null) {
    return null;
  }

  return {
    token,
    expiresAt: {
      type: 'Date',
      value: expiresAtValue,
    },
  };
};
