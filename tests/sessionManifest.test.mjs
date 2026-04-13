import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const manifestPath = path.join(
  process.cwd(),
  'src/json/session/pandasuite.json',
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

test('session manifest exposes email-link sign-in actions and events', () => {
  const actionIds = manifest.actions.map((action) => action.id);
  const eventIds = manifest.events.map((event) => event.id);
  const propertyIds = manifest.properties.map((property) => property.id);
  const requestAction = manifest.actions.find(
    (action) => action.id === 'requestEmailLinkSignIn',
  );
  const continueUrlParam = requestAction.params.find(
    (param) => param.id === 'continueUrl',
  );

  assert.deepEqual(actionIds.includes('requestEmailLinkSignIn'), true);
  assert.deepEqual(actionIds.includes('completeEmailLinkSignIn'), true);
  assert.deepEqual(eventIds.includes('onEmailLinkRequested'), true);
  assert.deepEqual(eventIds.includes('onEmailLinkRequestError'), true);
  assert.deepEqual(propertyIds.includes('emailLinkContinueUrl'), false);
  assert.deepEqual(propertyIds.includes('emailLinkLinkDomain'), false);
  assert.deepEqual(
    requestAction.params.map((param) => param.id),
    ['email', 'continueUrl'],
  );
  assert.equal(continueUrlParam.bindable, true);
});
