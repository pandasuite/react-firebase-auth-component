# IndexedDB Safari workaround — characterization

Before Task 11, two copies of `fixIndexDbBug()` ran on normal startup paths:

- `src/components/session/SessionRuntime.jsx` — on every sign-in (guarded).
- `src/pages/Home/index.jsx` — on every Home mount (unguarded).

Both deleted `firestore/*` IndexedDB databases when `openDB(...).getAll('owner')`
does not settle within 200 ms. On a slow device this deletes **pending offline
writes**. The optimistic-writes design forbids deletion on any normal startup
path (spec: Persistence).

## Suspected original failure

Safari (including PandaSuite WebViews) could leave the Firestore IndexedDB in a
state where opening it hangs forever, blocking all Firestore startup. The
workaround probed the `owner` object store and deleted the database when the
probe hung.

## Protocol

Run each scenario on: macOS Safari (current), iOS Safari (current), one
supported PandaSuite iOS WebView, one supported Android WebView.

1. **Baseline**: `yarn start:session`, sign in, write data, reload. Expect: no
   hang, data present.
2. **Interrupted first open**: sign in, then kill the tab during initial load
   (within ~1s). Reopen. Expect to characterize: does Firestore startup hang?
3. **Multi-tab contention**: open two tabs, sign in in both, reload both
   simultaneously ×5. Expect to characterize: any hang or
   `failed-precondition`?
4. **Private mode**: repeat baseline in private browsing. Expect:
   `enablePersistence` rejects, memory fallback, page still works.
5. **Pending offline writes across reload**: go offline (DevTools), perform 3
   change actions, reload while offline, reconnect. Expect: writes submit after
   reconnection. **This is the scenario the old workaround could destroy.**

For any hang: capture the console, `indexedDB.databases()` output, and whether
deleting `firestore/*` manually unblocks the next load.

## Results

| Scenario | Platform | Result | Hang reproduced? |
| --- | --- | --- | --- |
| (fill during execution) | | | |

## Decision

- This branch performs no automatic IndexedDB deletion or recovery.
- If persistence is rejected, the app warns and continues with the Firestore
  memory fallback.
- `onChangeError` reports writes submitted by the current page. After a reload,
  Firestore restores pending writes and reconciles rejected mutations through
  snapshots, but it cannot restore the originating JavaScript callbacks.
- If real Safari/WebView characterization reproduces the historical hang,
  release is blocked until a separate pre-consumer recovery design is
  implemented and verified on the failing platform (spec: Persistence).

# Post-implementation browser/WebView verification

Run with `yarn start:session` (Chrome DevTools for offline simulation), then on
Safari and one supported PandaSuite WebView per platform. All items must pass
before release.

- [ ] A `change` action updates the PandaSuite queryable **before** server
      acknowledgement (throttle network to Slow 3G; UI reflects the change
      immediately).
- [ ] With DevTools offline: 3 change actions on the same document emit **no**
      `onChangeError`, and after reconnection the server document reflects all
      3 in submission order.
- [ ] Reload while offline with persistent cache: pending writes survive the
      reload and submit after reconnection.
- [ ] Two tabs signed in as the same user see a coherent local view
      (`synchronizeTabs`).
- [ ] Private-browsing (persistence rejected): one degraded-mode `console.warn`,
      no `onChangeError`, live writes still work.
- [ ] DevTools → Application → IndexedDB: after sign-in and navigation to Home,
      the `firestore/*` database is never deleted (normal startup performs no
      recovery).
- [ ] Safari + WebViews: pending offline writes survive a reload (the scenario
      the old workaround destroyed).
