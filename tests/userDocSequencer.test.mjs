import assert from 'node:assert/strict';
import test from 'node:test';

import { createUserDocSequencer } from '../src/hooks/useFirebaseWithBridge/userDocSequencer.mjs';

// Deterministic fakes. `planAction` delegates to a per-test queue of plans or
// a function; `submitWrite` records calls and returns controllable promises.
const createHarness = ({ planAction }) => {
  const writes = [];
  const errors = [];
  const pending = [];
  const sequencer = createUserDocSequencer({
    planAction,
    submitWrite: (write) => {
      writes.push(write);
      return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
    readCache: () => Promise.reject(new Error('not used in this task')),
    onChangeError: (code, message) => errors.push({ code, message }),
  });
  return { sequencer, writes, errors, pending };
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('actions are held until a snapshot establishes existence', async () => {
  const { sequencer, writes } = createHarness({
    planAction: ({ userDoc }) => ({
      kind: 'targeted-write',
      update: { a: 1 },
      expectedDoc: { ...userDoc, a: 1 },
    }),
  });

  sequencer.setUid('u1');
  sequencer.enqueue({ uid: 'u1', modify: { property: '/a', func: 'set', value: 1 } });
  assert.equal(writes.length, 0);
  assert.equal(sequencer.inspect().queueLength, 1);

  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: true, getData: () => ({}) });
  assert.equal(writes.length, 1);
  assert.equal(sequencer.inspect().queueLength, 0);
});

test('a cache miss does not establish missing; a non-cache snapshot does', () => {
  const { sequencer, writes } = createHarness({
    planAction: () => ({ kind: 'targeted-write', update: { a: 1 }, expectedDoc: { a: 1 } }),
  });

  sequencer.setUid('u1');
  sequencer.enqueue({ uid: 'u1', modify: {} });

  sequencer.handleSnapshot({ uid: 'u1', exists: false, fromCache: true, getData: () => undefined });
  assert.equal(sequencer.inspect().existence, 'unknown');
  assert.equal(writes.length, 0);

  sequencer.handleSnapshot({ uid: 'u1', exists: false, fromCache: false, getData: () => undefined });
  assert.equal(sequencer.inspect().existence, 'missing');
  // Known missing: queued action resolved as a documented silent no-op.
  assert.equal(writes.length, 0);
  assert.equal(sequencer.inspect().queueLength, 0);
});

test('known-missing recovers when a snapshot observes creation by an owning flow', () => {
  const { sequencer, writes } = createHarness({
    planAction: ({ userDoc }) => ({
      kind: 'targeted-write',
      update: { a: 1 },
      expectedDoc: { ...userDoc, a: 1 },
    }),
  });

  sequencer.setUid('u1');
  sequencer.handleSnapshot({ uid: 'u1', exists: false, fromCache: false, getData: () => undefined });
  sequencer.enqueue({ uid: 'u1', modify: {} });
  assert.equal(writes.length, 0);

  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({ seeded: true }) });
  sequencer.enqueue({ uid: 'u1', modify: {} });
  assert.equal(writes.length, 1);
});

test('non-transform actions chain on expectedDoc while writes stay pending', async () => {
  const seen = [];
  const { sequencer, writes } = createHarness({
    planAction: ({ modify, userDoc }) => {
      seen.push(userDoc);
      if (modify.func === 'add') {
        return {
          kind: 'targeted-write',
          update: {},
          expectedDoc: { rows: [{ id: '1', counter: 0 }] },
        };
      }
      return {
        kind: 'targeted-write',
        update: {},
        expectedDoc: { rows: [{ id: '1', counter: 1 }] },
      };
    },
  });

  sequencer.setUid('u1');
  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({ rows: [] }) });
  sequencer.enqueue({ uid: 'u1', modify: { func: 'add' } });
  sequencer.enqueue({ uid: 'u1', modify: { func: 'inc' } });

  // Neither write promise has settled, yet the second plan saw the first's effect.
  assert.equal(writes.length, 2);
  assert.deepEqual(seen[0], { rows: [] });
  assert.deepEqual(seen[1], { rows: [{ id: '1', counter: 0 }] });
});

test('noop plans skip the write; invalid plans emit onChangeError and continue', () => {
  const plans = [
    { kind: 'noop' },
    { kind: 'invalid', reason: 'change/invalid-pointer' },
    { kind: 'targeted-write', update: { a: 1 }, expectedDoc: { a: 1 } },
  ];
  const { sequencer, writes, errors } = createHarness({
    planAction: () => plans.shift(),
  });

  sequencer.setUid('u1');
  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({}) });
  sequencer.enqueue({ uid: 'u1', modify: {} });
  sequencer.enqueue({ uid: 'u1', modify: {} });
  sequencer.enqueue({ uid: 'u1', modify: {} });

  assert.equal(writes.length, 1);
  assert.deepEqual(errors, [
    {
      code: 'change/invalid-pointer',
      message: 'Cannot apply change: change/invalid-pointer',
    },
  ]);
});

test('planning exceptions emit onChangeError and do not block later actions', () => {
  const { sequencer, writes, errors } = createHarness({
    planAction: ({ modify }) => {
      if (modify.property === '/broken') {
        throw new Error('planner exploded');
      }
      return {
        kind: 'targeted-write',
        update: { ok: true },
        expectedDoc: { ok: true },
      };
    },
  });

  sequencer.setUid('u1');
  sequencer.enqueue({ uid: 'u1', modify: { property: '/broken' } });
  sequencer.enqueue({ uid: 'u1', modify: { property: '/ok' } });

  assert.doesNotThrow(() => {
    sequencer.handleSnapshot({
      uid: 'u1',
      exists: true,
      fromCache: false,
      getData: () => ({}),
    });
  });
  assert.deepEqual(errors, [
    { code: 'change/planning-failed', message: 'planner exploded' },
  ]);
  assert.equal(writes.length, 1);
  assert.equal(sequencer.inspect().queueLength, 0);
});

test('a synchronous submit failure reports the error and leaves planningDoc unchanged', () => {
  const errors = [];
  const sequencer = createUserDocSequencer({
    planAction: () => ({ kind: 'targeted-write', update: { a: 1 }, expectedDoc: { a: 1 } }),
    submitWrite: () => {
      throw new Error('boom');
    },
    readCache: () => Promise.reject(new Error('unused')),
    onChangeError: (code, message) => errors.push({ code, message }),
  });

  sequencer.setUid('u1');
  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({ a: 0 }) });
  sequencer.enqueue({ uid: 'u1', modify: {} });

  assert.equal(errors.length, 1);
  assert.deepEqual(sequencer.inspect().planningDoc, { a: 0 });
  assert.equal(sequencer.inspect().unsettledCount, 0);
});

test('UID change resets state and never flushes old actions into the new user', () => {
  const { sequencer, writes, errors } = createHarness({
    planAction: () => ({ kind: 'targeted-write', update: { a: 1 }, expectedDoc: { a: 1 } }),
  });

  sequencer.setUid('u1');
  sequencer.enqueue({ uid: 'u1', modify: {} }); // held: existence unknown

  sequencer.setUid('u2');
  sequencer.handleSnapshot({ uid: 'u2', exists: true, fromCache: false, getData: () => ({}) });
  assert.equal(writes.length, 0, 'u1 action must not run for u2');
  assert.equal(sequencer.inspect().queueLength, 0);

  // Stale enqueue carrying the old uid is dropped with an error.
  sequencer.enqueue({ uid: 'u1', modify: {} });
  assert.equal(errors.at(-1).code, 'change/uid-mismatch');

  // Stale snapshot for the old uid is ignored.
  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({ stale: 1 }) });
  assert.deepEqual(sequencer.inspect().planningDoc, {});
});

test('resolving a prior UID write cannot settle or unblock the active UID', async () => {
  const { sequencer, pending } = createHarness({
    planAction: ({ modify }) => ({
      kind: 'targeted-write',
      update: { value: modify.value },
      expectedDoc: { value: modify.value },
    }),
  });

  sequencer.setUid('u1');
  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({}) });
  sequencer.enqueue({ uid: 'u1', modify: { value: 'u1 optimistic' } });

  sequencer.setUid('u2');
  sequencer.handleSnapshot({ uid: 'u2', exists: true, fromCache: false, getData: () => ({}) });
  sequencer.enqueue({ uid: 'u2', modify: { value: 'u2 optimistic' } });
  assert.equal(sequencer.inspect().unsettledCount, 1);

  pending[0].resolve();
  await settle();
  assert.equal(sequencer.inspect().unsettledCount, 1);

  sequencer.handleSnapshot({
    uid: 'u2',
    exists: true,
    fromCache: false,
    getData: () => ({ value: 'u2 stale snapshot' }),
  });
  assert.deepEqual(sequencer.inspect().planningDoc, { value: 'u2 optimistic' });
});

test('rejecting a prior UID write cannot settle the active UID or report an error', async () => {
  const { sequencer, errors, pending } = createHarness({
    planAction: ({ modify }) => ({
      kind: 'targeted-write',
      update: { value: modify.value },
      expectedDoc: { value: modify.value },
    }),
  });

  sequencer.setUid('u1');
  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({}) });
  sequencer.enqueue({ uid: 'u1', modify: { value: 'u1 optimistic' } });

  sequencer.setUid('u2');
  sequencer.handleSnapshot({ uid: 'u2', exists: true, fromCache: false, getData: () => ({}) });
  sequencer.enqueue({ uid: 'u2', modify: { value: 'u2 optimistic' } });

  const oldUserError = new Error('u1 write failed');
  oldUserError.code = 'permission-denied';
  pending[0].reject(oldUserError);
  await settle();

  assert.equal(sequencer.inspect().unsettledCount, 1);
  assert.deepEqual(errors, []);
});

test('a rejection resumed after returning to the originating UID is still reported', async () => {
  const { sequencer, errors, pending } = createHarness({
    planAction: ({ modify }) => ({
      kind: 'targeted-write',
      update: { value: modify.value },
      expectedDoc: { value: modify.value },
    }),
  });

  sequencer.setUid('u1');
  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({}) });
  sequencer.enqueue({ uid: 'u1', modify: { value: 'queued offline' } });

  // Auth bounces to another user and back before the write settles; the
  // offline queue then resumes u1's mutation and the server rejects it.
  sequencer.setUid('u2');
  sequencer.setUid('u1');

  const rejection = Object.assign(new Error('denied'), { code: 'permission-denied' });
  pending[0].reject(rejection);
  await settle();

  assert.equal(errors.at(-1)?.code, 'permission-denied');
});

test('write settlements are inert after dispose', async () => {
  const { sequencer, errors, pending } = createHarness({
    planAction: ({ modify }) => ({
      kind: 'targeted-write',
      update: { value: modify.value },
      expectedDoc: { value: modify.value },
    }),
  });

  sequencer.setUid('u1');
  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({}) });
  sequencer.enqueue({ uid: 'u1', modify: { value: 1 } });
  sequencer.enqueue({ uid: 'u1', modify: { value: 2 } });
  sequencer.dispose();

  pending[0].resolve();
  pending[1].reject(new Error('disposed write failed'));
  await settle();

  assert.equal(sequencer.inspect().unsettledCount, 2);
  assert.deepEqual(errors, []);
});

// Harness with controllable cache reads.
const defaultRebasePlanAction = ({ modify, userDoc }) => ({
  kind: 'targeted-write',
  update: { [modify.key]: modify.value },
  expectedDoc: { ...userDoc, [modify.key]: modify.value },
});

const createRebaseHarness = ({ planAction = defaultRebasePlanAction } = {}) => {
  const writes = [];
  const errors = [];
  const pendingWrites = [];
  const cacheReads = [];
  const sequencer = createUserDocSequencer({
    planAction,
    submitWrite: (write) => {
      writes.push(write);
      return new Promise((resolve, reject) => {
        pendingWrites.push({ resolve, reject });
      });
    },
    readCache: () =>
      new Promise((resolve, reject) => {
        cacheReads.push({ resolve, reject });
      }),
    onChangeError: (code, message) => errors.push({ code, message }),
  });
  sequencer.setUid('u1');
  sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({}) });
  return { sequencer, writes, errors, pendingWrites, cacheReads };
};

test('atomic transforms rebase from Firestore local view before later actions', async () => {
  const seen = [];
  const h = createRebaseHarness({
    planAction: ({ modify, userDoc }) => {
      seen.push(userDoc);
      if (modify.kind === 'transform') {
        return {
          kind: 'atomic-transform',
          update: {},
          // The JS planner cannot distinguish an encoded double 1 from an
          // integer 1, so this prediction can differ from Firestore's view.
          expectedDoc: { arr: [1] },
        };
      }
      return {
        kind: 'targeted-write',
        update: { touched: true },
        expectedDoc: { ...userDoc, touched: true },
      };
    },
  });
  h.sequencer.handleSnapshot({
    uid: 'u1',
    exists: true,
    fromCache: false,
    getData: () => ({ arr: [1] }),
  });

  h.sequencer.enqueue({ uid: 'u1', modify: { kind: 'transform' } });
  h.sequencer.enqueue({ uid: 'u1', modify: { kind: 'follow-up' } });

  assert.equal(h.writes.length, 1, 'follow-up waits for the local cache view');
  await settle();
  assert.equal(h.cacheReads.length, 1);

  h.cacheReads[0].resolve({ exists: true, data: { arr: [1, 1] } });
  await settle();

  assert.equal(h.writes.length, 2);
  assert.deepEqual(seen, [{ arr: [1] }, { arr: [1, 1] }]);
});

test('zero-count transition triggers a cache rebase that replaces planningDoc', async () => {
  const h = createRebaseHarness();
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'a', value: 1 } });

  h.pendingWrites[0].resolve();
  await settle();
  assert.equal(h.cacheReads.length, 1, 'rebase read scheduled at zero transition');

  h.cacheReads[0].resolve({ exists: true, data: { a: 1, remote: 'merged' } });
  await settle();
  assert.deepEqual(h.sequencer.inspect().planningDoc, { a: 1, remote: 'merged' });
  assert.equal(h.sequencer.inspect().rebaseInFlight, false);
});

test('an action arriving during a rebase is held, then planned from the rebased doc', async () => {
  const h = createRebaseHarness();
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'a', value: 1 } });
  h.pendingWrites[0].resolve();
  await settle();

  // New action while the cache read is in flight: no write yet.
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'b', value: 2 } });
  assert.equal(h.writes.length, 1);
  assert.equal(h.sequencer.inspect().queueLength, 1);

  h.cacheReads[0].resolve({ exists: true, data: { a: 1 } });
  await settle();

  // The held action was planned from the rebased base.
  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.sequencer.inspect().planningDoc, { a: 1, b: 2 });
});

test('actions arriving between a rejection and its rebase never plan from rejected state', async () => {
  const h = createRebaseHarness();
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'a', value: 1 } });

  const rejection = Object.assign(new Error('denied'), { code: 'permission-denied' });
  h.pendingWrites[0].reject(rejection);
  await settle();
  assert.equal(h.cacheReads.length, 1, 'rejection schedules a rebase');

  // Action arrives before the corrective cache read resolves: it must wait,
  // otherwise it would be planned from a planningDoc containing the rejected
  // mutation and the corrective result would then be discarded.
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'b', value: 2 } });
  assert.equal(h.writes.length, 1, 'planning deferred until the rebase lands');

  // Server view: the rejected write never applied.
  h.cacheReads[0].resolve({ exists: true, data: {} });
  await settle();

  assert.equal(h.writes.length, 2);
  assert.deepEqual(h.sequencer.inspect().planningDoc, { b: 2 });
});

test('a write rejection reports onChangeError and rebases even with later writes pending', async () => {
  const h = createRebaseHarness();
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'a', value: 1 } });
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'b', value: 2 } });

  const rejection = Object.assign(new Error('denied'), { code: 'permission-denied' });
  h.pendingWrites[0].reject(rejection);
  await settle();

  assert.equal(h.errors.at(-1).code, 'permission-denied');
  assert.equal(h.cacheReads.length, 1, 'rejection schedules an immediate rebase');

  // Cache view: rejected mutation removed, remaining overlay (b) applied.
  h.cacheReads[0].resolve({ exists: true, data: { b: 2 } });
  await settle();
  assert.deepEqual(h.sequencer.inspect().planningDoc, { b: 2 });
});

test('cache-read failure leaves planningDoc unchanged and does not block later actions', async () => {
  const h = createRebaseHarness();
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'a', value: 1 } });
  h.pendingWrites[0].resolve();
  await settle();

  h.cacheReads[0].reject(new Error('unavailable'));
  await settle();
  assert.deepEqual(h.sequencer.inspect().planningDoc, { a: 1 });
  assert.equal(h.sequencer.inspect().rebaseInFlight, false);

  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'c', value: 3 } });
  assert.equal(h.writes.length, 2);
});

test('a cache result reporting exists=false transitions to known-missing', async () => {
  const h = createRebaseHarness();
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'a', value: 1 } });
  h.pendingWrites[0].resolve();
  await settle();

  h.cacheReads[0].resolve({ exists: false, data: undefined });
  await settle();
  assert.equal(h.sequencer.inspect().existence, 'missing');

  // Subsequent actions are documented no-ops, not errors.
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'd', value: 4 } });
  assert.equal(h.writes.length, 1);
  assert.equal(h.errors.length, 0);
});

test('snapshots are ignored while writes are unsettled or a rebase is in flight', async () => {
  const h = createRebaseHarness();
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'a', value: 1 } });

  // Unsettled write: snapshot must not regress the optimistic chain.
  h.sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({ old: true }) });
  assert.deepEqual(h.sequencer.inspect().planningDoc, { a: 1 });

  h.pendingWrites[0].resolve();
  await settle();
  // Rebase in flight: still ignored.
  h.sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({ old: true }) });
  assert.deepEqual(h.sequencer.inspect().planningDoc, { a: 1 });

  h.cacheReads[0].resolve({ exists: true, data: { a: 1 } });
  await settle();
  // Idle again: snapshots refresh the base.
  h.sequencer.handleSnapshot({ uid: 'u1', exists: true, fromCache: false, getData: () => ({ fresh: 1 }) });
  assert.deepEqual(h.sequencer.inspect().planningDoc, { fresh: 1 });
});

test('UID change invalidates an in-flight rebase', async () => {
  const h = createRebaseHarness();
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'a', value: 1 } });
  h.pendingWrites[0].resolve();
  await settle();

  h.sequencer.setUid('u2');
  h.cacheReads[0].resolve({ exists: true, data: { a: 1 } });
  await settle();

  assert.equal(h.sequencer.inspect().existence, 'unknown');
  assert.equal(h.sequencer.inspect().planningDoc, null);
});

test('an older rebase cannot apply or clear a newer in-flight rebase', async () => {
  const h = createRebaseHarness();
  // Two writes issued while idle, both left pending.
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'a', value: 1 } });
  h.sequencer.enqueue({ uid: 'u1', modify: { key: 'b', value: 2 } });

  const rejection = Object.assign(new Error('denied'), { code: 'permission-denied' });
  h.pendingWrites[0].reject(rejection);
  await settle();
  assert.equal(h.cacheReads.length, 1, 'first rejection schedules a rebase');

  h.pendingWrites[1].reject(rejection);
  await settle();
  assert.equal(h.cacheReads.length, 2, 'second rejection schedules a newer rebase');

  h.cacheReads[0].resolve({ exists: true, data: { stale: true } });
  await settle();
  assert.deepEqual(h.sequencer.inspect().planningDoc, { a: 1, b: 2 });
  assert.equal(h.sequencer.inspect().rebaseInFlight, true);

  h.sequencer.handleSnapshot({
    uid: 'u1',
    exists: true,
    fromCache: false,
    getData: () => ({ snapshotMustNotWin: true }),
  });
  assert.deepEqual(h.sequencer.inspect().planningDoc, { a: 1, b: 2 });

  h.cacheReads[1].resolve({ exists: true, data: { current: true } });
  await settle();
  assert.deepEqual(h.sequencer.inspect().planningDoc, { current: true });
  assert.equal(h.sequencer.inspect().rebaseInFlight, false);
});
