import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  usePandaBridge,
  Tabs,
  Tab,
  Button,
  Input,
  Alert,
} from 'pandasuite-bridge-react';
import PandaBridge, { Binder } from 'pandasuite-bridge';
import cloneDeep from 'lodash/cloneDeep';
import { useIntl } from 'react-intl';

import { JSONEditor } from '@beingenious/jsoneditor';
import '@beingenious/jsoneditor/dist/style.css';

import FirebaseBridgeContext from '../../FirebaseBridgeContext';

const editorConfig = {
  title: null,
  viewSwitchControl: true,
  buttonSave: false,
  readOnly: false,
  gridView: {
    sideBar: false,
    columns: {
      main: {
        suppressHeaderMenuButton: true,
        suppressHeaderContextMenu: true,
        suppressHeaderFilterButton: true,
        sortable: false,
      },
    },
  },
  rawView: {
    importJson: false,
    exportJson: false,
    formatJson: false,
    compressJson: false,
  },
};

function SessionSetup() {
  const firebaseWithBridge = useContext(FirebaseBridgeContext);
  const { auth, firestore, bridge } = firebaseWithBridge || {};
  const bridgeProperties = bridge?.properties || {};
  const { properties, setProperty } = usePandaBridge();
  const intl = useIntl();

  const [currentUser, setCurrentUser] = useState(
    (auth && auth.currentUser) || null,
  );
  const [userDoc, setUserDoc] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [credentials, setCredentials] = useState({
    email: '',
    password: '',
  });
  const [schema, setSchema] = useState(() =>
    cloneDeep(properties?.defaultUserSchema || {}),
  );

  useEffect(() => {
    setSchema(cloneDeep(properties?.defaultUserSchema || {}));
  }, [properties?.defaultUserSchema]);

  const shouldRender = PandaBridge.isStudio && properties !== undefined;

  // Send defaultUserSchema as queryable when no user is logged in (studio mode)
  useEffect(() => {
    if (!shouldRender || currentUser) {
      return;
    }
    PandaBridge.send(PandaBridge.UPDATED, {
      queryable: schema,
    });
  }, [shouldRender, currentUser, schema]);

  const { __ps_externalPaths: externalPaths, __ps_screens: rawScreens } =
    bridgeProperties;

  const jsonEditorMisc = useMemo(() => {
    if (!Array.isArray(rawScreens)) {
      return { screens: [] };
    }

    const screens = rawScreens
      .map((item) => item && item.value)
      .filter((value) => value && value.did)
      .map((value) => ({
        id: value.did,
        name: value.name || value.did,
      }));

    return { screens };
  }, [rawScreens]);

  useEffect(() => {
    if (!shouldRender || !auth) {
      return undefined;
    }

    const unsubscribe = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
      setAuthError(null);
      setIsSubmitting(false);
      if (!user) {
        setUserDoc(null);
      }
    });

    return () => unsubscribe();
  }, [auth, shouldRender]);

  useEffect(() => {
    if (!firestore || !currentUser) {
      return undefined;
    }

    const unsubscribe = firestore
      .collection('users')
      .doc(currentUser.uid)
      .onSnapshot(
        (snapshot) => {
          setUserDoc(snapshot.data() || {});
        },
        (error) => {
          console.error(error);
        },
      );

    return () => unsubscribe();
  }, [currentUser, firestore]);

  const handleCredentialsChange = useCallback((event) => {
    const { name, value } = event.target;
    setCredentials((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  const handleSignIn = useCallback(
    (event) => {
      event.preventDefault();
      if (!auth) {
        return;
      }

      setIsSubmitting(true);
      setAuthError(null);
      auth
        .signInWithEmailAndPassword(credentials.email, credentials.password)
        .then(() => {
          setIsSubmitting(false);
          setCredentials({ email: '', password: '' });
        })
        .catch((error) => {
          setAuthError(error);
          setIsSubmitting(false);
        });
    },
    [auth, credentials.email, credentials.password],
  );

  const handleSignOut = useCallback(() => {
    if (auth) {
      auth.signOut();
    }
  }, [auth]);

  const handleSchemaChange = useCallback(
    (newSchema) => {
      setSchema(newSchema);
      setProperty('defaultUserSchema', newSchema);
    },
    [setProperty],
  );

  if (!shouldRender) {
    return null;
  }

  const renderSessionTab = () => {
    if (auth === false) {
      return (
        <Alert type="danger" className="mt-4">
          {intl.formatMessage({ id: 'session.editor.alert.invalidConfig' })}
        </Alert>
      );
    }

    if (auth === null) {
      return (
        <Alert type="info" className="mt-4">
          {intl.formatMessage({ id: 'session.editor.alert.initializing' })}
        </Alert>
      );
    }

    return (
      <div className="space-y-4 text-gray-800">
        <p className="mt-4 text-sm text-gray-500">
          {intl.formatMessage({ id: 'session.editor.helper.login' })}
        </p>
        {currentUser && (
          <div className="flex items-center justify-between">
            <Button onClick={handleSignOut}>
              {intl.formatMessage({ id: 'session.editor.button.signOut' })}
            </Button>
          </div>
        )}
        {currentUser ? (
          <>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {intl.formatMessage({ id: 'session.editor.label.email' })}
                </dt>
                <dd className="font-mono text-base">
                  {currentUser.email || 'N/A'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {intl.formatMessage({ id: 'session.editor.label.uid' })}
                </dt>
                <dd className="font-mono text-base">{currentUser.uid}</dd>
              </div>
            </dl>
            {userDoc && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {intl.formatMessage({
                    id: 'session.editor.label.firestoreDoc',
                  })}
                </p>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-50 p-3 text-xs text-gray-800">
                  {JSON.stringify(userDoc, null, 2)}
                </pre>
              </div>
            )}
          </>
        ) : (
          <>
            <form className="space-y-4" onSubmit={handleSignIn}>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {intl.formatMessage({
                    id: 'session.editor.field.email',
                  })}
                </label>
                <Input
                  className="mt-1 w-full"
                  name="email"
                  type="email"
                  value={credentials.email}
                  onChange={handleCredentialsChange}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {intl.formatMessage({
                    id: 'session.editor.field.password',
                  })}
                </label>
                <Input
                  className="mt-1 w-full"
                  name="password"
                  type="password"
                  value={credentials.password}
                  onChange={handleCredentialsChange}
                  required
                />
              </div>
              {authError && (
                <Alert type="danger" className="text-sm">
                  {authError.message}
                </Alert>
              )}
              <Button loading={isSubmitting} type="submit">
                {intl.formatMessage({ id: 'session.editor.button.signIn' })}
              </Button>
            </form>
          </>
        )}
      </div>
    );
  };

  const renderSchemaTab = () => (
    <div className="flex h-full flex-col gap-4 overflow-hidden pt-4 text-gray-800">
      <p className="text-sm text-gray-500">
        {intl.formatMessage({ id: 'session.editor.helper.schema' })}
      </p>
      <div className="flex-1 min-h-0 overflow-hidden">
        <JSONEditor
          data={schema}
          misc={jsonEditorMisc}
          onChange={handleSchemaChange}
          config={editorConfig}
          externalPaths={externalPaths}
          bindingResolvers={{
            resolveShortTags: Binder.resolveShortTags,
            compatExpression: Binder.compatExpression,
          }}
        />
      </div>
    </div>
  );

  return (
    <div className="session-setup-container flex h-full flex-col overflow-hidden bg-white">
      <Tabs contentClassName="flex flex-1 flex-col min-h-0 overflow-hidden">
        <Tab
          eventKey="session"
          title={intl.formatMessage({ id: 'session.editor.tab.session' })}
        >
          {renderSessionTab()}
        </Tab>
        <Tab
          eventKey="schema"
          title={intl.formatMessage({ id: 'session.editor.tab.schema' })}
        >
          {renderSchemaTab()}
        </Tab>
      </Tabs>
    </div>
  );
}

export default SessionSetup;
