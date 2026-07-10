import assert from 'node:assert/strict';
import test from 'node:test';
import _ from 'lodash';

import {
  encodeIdKey,
  toQueryableShape,
} from '../../src/hooks/useFirebaseWithBridge/collectionStorageAdapter.mjs';
import {
  PROJECT_ID,
  createEmulatorClient,
  createRuntimeHarness,
  deleteAllApps,
  waitFor,
} from './helpers.mjs';

const seedClient = createEmulatorClient();
const seed = (uid, data) =>
  seedClient.firestore.collection('users').doc(uid).set(data);
const seedRawFields = async (uid, fields) => {
  const response = await fetch(
    `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(uid)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fields }),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to seed raw Firestore fields: ${response.status}`);
  }
};

test.after(async () => {
  await deleteAllApps();
});

test('two clients incrementing through change actions produce the sum', async () => {
  const uid = 'inc-sum';
  await seed(uid, { count: 0 });
  const a = createRuntimeHarness(uid);
  const b = createRuntimeHarness(uid);

  a.change({ property: '/count', func: 'inc', value: 2 });
  b.change({ property: '/count', func: 'inc', value: 3 });

  await waitFor(async () => (await a.serverDoc())?.count === 5);
  assert.deepEqual(a.errors, []);
  assert.deepEqual(b.errors, []);
});

test('concurrent writes to different fields are both retained', async () => {
  const uid = 'diff-fields';
  await seed(uid, { a: 1, b: 1 });
  const a = createRuntimeHarness(uid);
  const b = createRuntimeHarness(uid);

  a.change({ property: '/a', func: 'set', value: 2 });
  b.change({ property: '/b', func: 'set', value: 3 });

  await waitFor(async () => {
    const doc = await a.serverDoc();
    return doc?.a === 2 && doc?.b === 3;
  });
});

test('serverDoc ignores pending writer overlays until the server acknowledges them', async () => {
  const uid = 'server-observer';
  await seed(uid, { x: 0 });
  const a = createRuntimeHarness(uid);
  await waitFor(async () => (await a.serverDoc())?.x === 0);
  await waitFor(async () => (await a.localDoc())?.x === 0);

  await a.client.firestore.disableNetwork();
  try {
    a.change({ property: '/x', func: 'set', value: 1 });
    await waitFor(async () => (await a.localDoc())?.x === 1);

    assert.equal((await a.serverDoc())?.x, 0);
  } finally {
    await a.client.firestore.enableNetwork();
  }
});

test('offline array transforms rebase from Firestore numeric types before later actions', async () => {
  const uid = 'numeric-array-rebase';
  await seedRawFields(uid, {
    arr: {
      arrayValue: {
        values: [
          {
            mapValue: {
              fields: { v: { doubleValue: 1 } },
            },
          },
        ],
      },
    },
  });
  const a = createRuntimeHarness(uid);
  await waitFor(async () => (await a.localDoc())?.arr?.length === 1);

  await a.client.firestore.disableNetwork();
  try {
    // The SDK encodes this operand as integerValue: 1, so Firestore's local
    // arrayUnion keeps it distinct from the REST-seeded doubleValue: 1.
    a.change({ property: '/arr', func: 'add', value: { v: 1 } });
    a.change({
      property: '/arr/@getByIndex:1/marked',
      func: 'set',
      value: true,
    });

    const local = await waitFor(async () => {
      const doc = await a.localDoc();
      return doc?.arr?.[1]?.v === 1 && doc.arr[1].marked === true ? doc : null;
    });
    assert.deepEqual(local.arr, [{ v: 1 }, { v: 1, marked: true }]);
  } finally {
    await a.client.firestore.enableNetwork();
  }
});

test('concurrent rewrites of one plain array are last-write-wins', async () => {
  const uid = 'array-lww';
  const initialArr = [{ id: '1', v: 1 }, { id: '2', v: 2 }];
  await seed(uid, { arr: initialArr });
  const a = createRuntimeHarness(uid);
  const b = createRuntimeHarness(uid);
  await waitFor(async () => (await a.serverDoc()) !== null);
  await waitFor(async () => {
    const [aDoc, bDoc] = await Promise.all([a.localDoc(), b.localDoc()]);
    return _.isEqual(aDoc?.arr, initialArr) && _.isEqual(bDoc?.arr, initialArr);
  });

  await a.client.firestore.disableNetwork();
  await b.client.firestore.disableNetwork();

  // Nested mutations in a plain array rewrite the whole array (spec mapping).
  a.change({ property: '/arr/@find:id|eq|1/v', func: 'set', value: 9 });
  b.change({ property: '/arr/@find:id|eq|2/v', func: 'set', value: 8 });

  await a.client.firestore.enableNetwork();
  await waitFor(async () => (await a.serverDoc())?.arr?.[0]?.v === 9);
  await b.client.firestore.enableNetwork();

  // B's rewrite arrives last and wins the whole array; A's edit is lost.
  await waitFor(async () => (await a.serverDoc())?.arr?.[1]?.v === 8);
  const doc = await a.serverDoc();
  assert.deepEqual(doc.arr, [{ id: '1', v: 1 }, { id: '2', v: 8 }]);
});

test('plain-array delbyid removes the exact local row; a concurrent change prevents the match', async () => {
  const uid = 'delbyid-stale';
  const initialArr = [{ id: '1', v: 1 }];
  await seed(uid, { arr: initialArr });
  const a = createRuntimeHarness(uid);
  const b = createRuntimeHarness(uid);
  await waitFor(async () => (await a.serverDoc()) !== null);
  await waitFor(async () => _.isEqual((await a.localDoc())?.arr, initialArr));

  await a.client.firestore.disableNetwork();

  // B changes the row first (whole-array rewrite), acknowledged by the server.
  b.change({ property: '/arr/@find:id|eq|1/v', func: 'set', value: 2 });
  await waitFor(async () => (await b.serverDoc())?.arr?.[0]?.v === 2);

  // A deletes based on its stale local row {id:'1', v:1}: arrayRemove misses.
  a.change({ property: '/arr', func: 'delbyid', value: '1' });
  await a.client.firestore.enableNetwork();

  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });
  const doc = await b.serverDoc();
  assert.deepEqual(doc.arr, [{ id: '1', v: 2 }], 'stale delete must be a no-op');
});

test('Collection membership and row commit atomically in one write', async () => {
  const uid = 'collection-atomic';
  await seed(uid, { items: { type: 'Collection', order: [], valueById: {} } });
  const a = createRuntimeHarness(uid);

  a.change({ property: '/items', func: 'add', value: { id: '1', v: 1 } });

  const doc = await waitFor(async () => {
    const d = await a.serverDoc();
    return d?.items?.order?.length === 1 ? d : null;
  });
  // Same server document version holds both membership and the row.
  assert.deepEqual(doc.items.order, ['1']);
  const [rowKey] = Object.keys(doc.items.valueById);
  assert.deepEqual(doc.items.valueById[rowKey], { id: '1', v: 1 });
});

test('an identical canonical add does not overwrite another row changed remotely', async () => {
  const uid = 'collection-identical-add';
  const initialItems = {
    type: 'Collection',
    order: ['1', '2'],
    valueById: {
      [encodeIdKey('1')]: { id: '1', v: 1 },
      [encodeIdKey('2')]: { id: '2', v: 1 },
    },
  };
  await seed(uid, { items: initialItems });
  const a = createRuntimeHarness(uid);
  const b = createRuntimeHarness(uid);
  await waitFor(async () => _.isEqual((await a.localDoc())?.items, initialItems));

  await a.client.firestore.disableNetwork();
  let networkDisabled = true;
  try {
    b.change({ property: '/items/@getById:2/v', func: 'set', value: 2 });
    await waitFor(
      async () =>
        (await b.serverDoc())?.items?.valueById?.[encodeIdKey('2')]?.v === 2,
    );

    a.change({ property: '/items', func: 'add', value: { id: '1', v: 1 } });
    await a.client.firestore.enableNetwork();
    networkDisabled = false;
    await a.client.firestore.waitForPendingWrites();

    const doc = await a.serverDoc();
    assert.equal(doc.items.valueById[encodeIdKey('2')].v, 2);
  } finally {
    if (networkDisabled) {
      await a.client.firestore.enableNetwork();
    }
  }
});

test('a canonical delbyid removes a row added while the deleting client was offline', async () => {
  const uid = 'collection-stale-delete';
  const emptyItems = { type: 'Collection', order: [], valueById: {} };
  await seed(uid, { items: emptyItems });
  const a = createRuntimeHarness(uid);
  const b = createRuntimeHarness(uid);
  await waitFor(async () => _.isEqual((await a.localDoc())?.items, emptyItems));

  await a.client.firestore.disableNetwork();
  let networkDisabled = true;
  try {
    b.change({ property: '/items', func: 'add', value: { id: '1', v: 1 } });
    await waitFor(
      async () => (await b.serverDoc())?.items?.order?.includes('1'),
    );

    a.change({ property: '/items', func: 'delbyid', value: '1' });
    await a.client.firestore.enableNetwork();
    networkDisabled = false;
    await a.client.firestore.waitForPendingWrites();

    const doc = await a.serverDoc();
    assert.deepEqual(doc.items.order, []);
    assert.equal(encodeIdKey('1') in doc.items.valueById, false);
  } finally {
    if (networkDisabled) {
      await a.client.firestore.enableNetwork();
    }
  }
});

test('a canonical delbyid removes a row stored under a legacy raw key', async () => {
  const uid = 'collection-raw-key-delete';
  const rawKey = 'foo';
  await seed(uid, {
    items: {
      type: 'Collection',
      order: [rawKey],
      valueById: { [rawKey]: { id: rawKey, v: 1 } },
    },
  });
  const a = createRuntimeHarness(uid);
  await waitFor(async () => (await a.localDoc())?.items?.order?.[0] === rawKey);

  a.change({ property: '/items', func: 'delbyid', value: rawKey });

  const doc = await waitFor(async () => {
    const serverDoc = await a.serverDoc();
    return serverDoc?.items?.order?.length === 0 ? serverDoc : null;
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(doc.items.valueById, rawKey),
    false,
  );
  assert.deepEqual(a.errors, []);
});

test('a stale canonical delbyid removes numeric membership added remotely', async () => {
  const uid = 'collection-stale-numeric-delete';
  const rowKey = encodeIdKey('1');
  const emptyItems = { type: 'Collection', order: [], valueById: {} };
  await seed(uid, { items: emptyItems });
  const a = createRuntimeHarness(uid);
  await waitFor(async () => _.isEqual((await a.localDoc())?.items, emptyItems));

  await a.client.firestore.disableNetwork();
  let networkDisabled = true;
  try {
    await seed(uid, {
      items: {
        type: 'Collection',
        order: [1],
        valueById: { [rowKey]: { id: '1', v: 1 } },
      },
    });

    a.change({ property: '/items', func: 'delbyid', value: '1' });
    await a.client.firestore.enableNetwork();
    networkDisabled = false;
    await a.client.firestore.waitForPendingWrites();

    const doc = await a.serverDoc();
    assert.deepEqual(doc.items.order, []);
    assert.equal(rowKey in doc.items.valueById, false);
  } finally {
    if (networkDisabled) {
      await a.client.firestore.enableNetwork();
    }
  }
});

test('incrementing a missing canonical row field preserves another remote row update', async () => {
  const uid = 'collection-missing-field-increment';
  const initialItems = {
    type: 'Collection',
    order: ['1', '2'],
    valueById: {
      [encodeIdKey('1')]: { id: '1' },
      [encodeIdKey('2')]: { id: '2', v: 1 },
    },
  };
  await seed(uid, { items: initialItems });
  const a = createRuntimeHarness(uid);
  const b = createRuntimeHarness(uid);
  await waitFor(async () => _.isEqual((await a.localDoc())?.items, initialItems));

  await a.client.firestore.disableNetwork();
  let networkDisabled = true;
  try {
    b.change({ property: '/items/@getById:2/v', func: 'set', value: 2 });
    await waitFor(
      async () =>
        (await b.serverDoc())?.items?.valueById?.[encodeIdKey('2')]?.v === 2,
    );

    a.change({
      property: '/items/@getById:1/score',
      func: 'inc',
      value: 2,
    });
    await a.client.firestore.enableNetwork();
    networkDisabled = false;
    await a.client.firestore.waitForPendingWrites();

    const doc = await a.serverDoc();
    assert.equal(doc.items.valueById[encodeIdKey('1')].score, 2);
    assert.equal(doc.items.valueById[encodeIdKey('2')].v, 2);
  } finally {
    if (networkDisabled) {
      await a.client.firestore.enableNetwork();
    }
  }
});

test('concurrent same-ID delete then add resolves to the last complete mutation', async () => {
  const uid = 'same-id-add-delete';
  const enc = (await import('../../src/hooks/useFirebaseWithBridge/collectionStorageAdapter.mjs')).encodeIdKey;
  const initialItems = {
    type: 'Collection',
    order: ['1'],
    valueById: { [enc('1')]: { id: '1', v: 1 } },
  };
  await seed(uid, { items: initialItems });
  const a = createRuntimeHarness(uid);
  const b = createRuntimeHarness(uid);
  await waitFor(async () => (await a.serverDoc()) !== null);
  await waitFor(async () => {
    const [aDoc, bDoc] = await Promise.all([a.localDoc(), b.localDoc()]);
    return (
      _.isEqual(aDoc?.items, initialItems) && _.isEqual(bDoc?.items, initialItems)
    );
  });

  await a.client.firestore.disableNetwork();
  await b.client.firestore.disableNetwork();

  a.change({ property: '/items', func: 'delbyid', value: '1' });
  b.change({ property: '/items', func: 'add', value: { id: '1', v: 5 } });

  await a.client.firestore.enableNetwork();
  await waitFor(async () => ((await a.serverDoc())?.items?.order ?? []).length === 0);
  await b.client.firestore.enableNetwork();

  // Add arrived last: membership and a complete row are back.
  const doc = await waitFor(async () => {
    const d = await a.serverDoc();
    return d?.items?.order?.length === 1 ? d : null;
  });
  assert.deepEqual(doc.items.valueById[enc('1')], { id: '1', v: 5 });
});

test('a delete racing a targeted row update stays absent from the queryable Collection', async () => {
  const uid = 'remove-wins';
  const enc = (await import('../../src/hooks/useFirebaseWithBridge/collectionStorageAdapter.mjs')).encodeIdKey;
  const initialItems = {
    type: 'Collection',
    order: ['1'],
    valueById: { [enc('1')]: { id: '1', v: 1 } },
  };
  await seed(uid, { items: initialItems });
  const a = createRuntimeHarness(uid);
  const b = createRuntimeHarness(uid);
  await waitFor(async () => (await a.serverDoc()) !== null);
  await waitFor(async () => _.isEqual((await a.localDoc())?.items, initialItems));

  await a.client.firestore.disableNetwork();

  // B deletes the row, acknowledged.
  b.change({ property: '/items', func: 'delbyid', value: '1' });
  await waitFor(async () => ((await b.serverDoc())?.items?.order ?? ['x']).length === 0);

  // A's targeted update of the now-deleted row lands afterwards.
  a.change({ property: '/items/@find:id|eq|1/v', func: 'set', value: 7 });
  await a.client.firestore.enableNetwork();

  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });
  const doc = await b.serverDoc();
  assert.deepEqual(doc.items.order, [], 'order stays authoritative: remove wins');
  const queryable = toQueryableShape(doc);
  assert.deepEqual(
    _.get(queryable, 'items.value', []).filter((row) => row.id === '1'),
    [],
    'orphan valueById entries are not projected',
  );
});

test('a Security Rules rejection emits onChangeError and is removed without transitive rollback', async () => {
  const uid = 'rules-rejection';
  await seed(uid, { ok: 0 });
  const a = createRuntimeHarness(uid);
  await waitFor(async () => (await a.serverDoc()) !== null);

  a.change({ property: '/forbidden', func: 'set', value: true });
  a.change({ property: '/ok', func: 'inc', value: 1 });

  await waitFor(() => a.errors.some((e) => e.code === 'permission-denied'));
  await waitFor(async () => (await a.serverDoc())?.ok === 1);
  const doc = await a.serverDoc();
  assert.equal('forbidden' in doc, false, 'rejected mutation removed');
  assert.equal(doc.ok, 1, 'independent later write is not rolled back');
});

test('a remote deletion makes queued targeted updates fail with not-found', async () => {
  const uid = 'remote-deletion';
  await seed(uid, { x: 0 });
  const a = createRuntimeHarness(uid);
  await waitFor(async () => (await a.serverDoc()) !== null);
  await waitFor(async () => (await a.localDoc())?.x === 0);

  await a.client.firestore.disableNetwork();
  a.change({ property: '/x', func: 'set', value: 1 });

  await seedClient.firestore.collection('users').doc(uid).delete();
  await a.client.firestore.enableNetwork();

  await waitFor(() => a.errors.some((e) => e.code === 'not-found'));
});

test('a server-confirmed missing document turns change actions into silent no-ops', async () => {
  const uid = 'known-missing';
  const a = createRuntimeHarness(uid); // never seeded: first non-cache snapshot confirms missing

  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });
  a.change({ property: '/a', func: 'set', value: 1 });

  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });
  assert.equal(await a.serverDoc(), null, 'change never creates the user document');
  assert.deepEqual(a.errors, [], 'documented no-op, not an error');
});

test('a literal Firestore path metacharacter is writable through change actions', async () => {
  const uid = 'literal-path-metacharacter';
  const key = 'score[kg]';
  await seed(uid, { profile: { [key]: 1 } });
  const a = createRuntimeHarness(uid);
  await waitFor(async () => (await a.localDoc())?.profile?.[key] === 1);

  a.change({
    property: [
      { func: 'getKey', value: 'profile' },
      { func: 'getKey', value: key },
    ],
    func: 'set',
    value: 2,
  });

  await waitFor(async () => (await a.serverDoc())?.profile?.[key] === 2);
  assert.deepEqual(a.errors, []);
});
