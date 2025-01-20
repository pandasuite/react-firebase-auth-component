import React, { useContext } from 'react';
import { useHistory } from 'react-router-dom';

import { useIntl } from 'react-intl';
import { Alert } from 'tabler-react';

import * as ROUTES from '../../constants/routes';
import FirebaseBridgeContext from '../../FirebaseBridgeContext';

function InvalidPage() {
  const intl = useIntl();
  const firebaseWithBridge = useContext(FirebaseBridgeContext);
  const history = useHistory();

  const { auth = false } = firebaseWithBridge || {};

  if (auth) {
    history.push(ROUTES.LANDING);
  }

  return (
    <Alert type="warning" icon="alert-triangle">
      {intl.formatMessage({ id: 'page.invalid.message' })}{' '}
      <a
        target="_blank"
        rel="noopener noreferrer"
        href={intl.formatMessage({ id: 'page.invalid.link.value' })}
      >
        {intl.formatMessage({ id: 'page.invalid.link.name' })}
      </a>
    </Alert>
  );
}

export default InvalidPage;
