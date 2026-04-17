# Phase 3c — Broken Bug Fixes

**Date**: 2026-04-17
**Precondition**: Phase 3b audit verification complete (Relay commit `41f6b7b`); 23 rows classified Broken, 1 Unknown (4.7).
**Out of scope**: 4.7 Refresh queue drop (needs deeper trace — defer to Phase 3d after 4a/4b).
**Goal**: Ship every Broken row to Fixed with minimum blast radius per PR.

---

## Approach

Six per-file PR groups. Each group is independent; each commit carries the row numbers it closes. No cross-group refactoring. Every `.catch` fix uses the same pattern — **direct logging or `Notice` for UI-facing rejection**, never silent swallow. XSS fix is the only security-bucket change. Reactivity bugs (3.1, 2.10, 4.2, 4.6, 4.8, 4.9) are structural — they require reading current code before editing.

Per-group acceptance criteria are stated below. Each group's commit message lists which rows it closes so the audit can be updated mechanically.

---

## Group A — Login / Auth (rows 1.2, 1.3, 1.4, 1.7, 1.8)

**Files**: `src/LoginManager.ts`, `src/components/LoggedIn.svelte`
**Theme**: auth-promise race + unhandled rejections on auth network paths.

| Row | Fix |
|-----|-----|
| 1.2 | `openLoginPage()` — gate `resolve(false)` on an in-flight flag (`_loginInFlight`). Listener resolves only when flag is cleared by login-window close. |
| 1.3 | `LoggedIn.svelte:259` — `await` or `.then()` on `lm.updateWebviewIntercepts()`; push returned regexes into `plugin.interceptedUrls`. |
| 1.4 | `LoggedIn.svelte:261-268` — drop the `throw e` in `.catch`; surface via `new Notice(String(e?.message ?? e))` + `logError`. |
| 1.7 | `LoginManager.authRefresh()` — add `.catch(logError)`; log level `warn` on network error. |
| 1.8 | `LoginManager.ts:304-313` — wrap `response.json` access in try/catch; return typed `ResponseParseError` on parse failure. |

**Acceptance**: Login flow exercised manually (login → cancel → re-open): no unhandled rejection in DevTools console; error path surfaces a Notice; loggedIn state never gets stuck on spinner.

---

## Group B — RelayManager loader (rows 1.5, 1.6, 2.10)

**Files**: `src/RelayManager.ts`
**Theme**: update()/login() rejection paths + DerivedMap memoization.

| Row | Fix |
|-----|-----|
| 1.5 | Realtime `subscribe()` promises at `RelayManager.ts:1822-1829` — add `.catch(logError)`; Notice on fatal (auth expired). |
| 1.6 | `login() → update() → Promise.all(promises)` — switch to `Promise.allSettled`; `setLoaded(true)` in `finally` so UI never hangs in loading. |
| 2.10 | `RelayAuto.folders` getter at `RelayManager.ts:1498-1505` — memoize predicate reference on the `RelayAuto` instance (e.g., `this._foldersPredicate ??= (folder) => ...`), so `filter()`'s WeakMap keeps its cache. Alternative: cache the derived map on the instance. |

**Acceptance**: Pulling plug on network during initial `login()` leaves the UI in a loaded-but-empty state (not a stuck spinner); Memory profiler shows no DerivedMap growth across 100 `RelayAuto.folders` reads.

---

## Group C — Relays list (rows 2.3, 2.4, 2.5, 2.8, 2.9)

**Files**: `src/components/Relays.svelte`, `src/SharedFolder.ts`
**Theme**: reactive prefixing, 429 handling, side-effect getter, unreachable branch, Notice gap.

| Row | Fix |
|-----|-----|
| 2.3 | `Relays.svelte:339` — add `$` prefix: `$subscriptions`. Verify Svelte compiler warning disappears. |
| 2.4 | `Relays.svelte:96-116` — explicit `if (status === 429) { Notice("Rate limited, retrying in Ns"); scheduleRetry(); return; }` branch before the generic `response.error` path. |
| 2.5 | `SharedFolder.ts:437-446` `get remote()` — move side-effect out; introduce `ensureRemote(): RelayFolder \| null` that performs the lookup; `get remote()` becomes a pure getter returning `this._remote`. Callers: update to `ensureRemote()` where side-effect was expected. |
| 2.8 | `Relays.svelte:310-324` — rewrite guard post-2.7 `loaded()` fix. New contract: show spinner while `!$sharedFolders.loaded()`, empty state when loaded && `size === 0`, else render list. |
| 2.9 | `Relays.svelte:362-376` — `.catch(err => new Notice(err.message))` on `getSubscriptionToken()`. Pattern from Phase 3a ManageRelay. |

**Acceptance**: Throttled connection produces a visible "rate limited" Notice, not a silent fallthrough. Subscription section renders reactively. Empty/loading/loaded states all exercised by simulation (intercept `pb.collection().getFullList()`).

---

## Group D — ManageRelay settings (rows 3.1, 3.3, 3.4, 3.5, 3.8)

**Files**: `src/components/ManageRelay.svelte`
**Theme**: async-in-derived fix, toggle race, debounce uncatch, `{:catch}`, XSS sanitation.

| Row | Fix |
|-----|-----|
| 3.1 | Hoist `getSubscriptionToken()` out of `derived($subscriptions, ...)`. Pattern: `derived` produces `{subscription, tokenKey}`, a separate writable `$tokenStore = writable<Record<tokenKey, Token>>({})`, and an effect that fetches and writes on `tokenKey` change. Subscribers get notified on both arrival. |
| 3.3 | Rapid relay toggle: wrap fetch in `AbortController`; when derived store is recreated (relay switch), call `abort()` on the prior controller. |
| 3.4 | Debounced `updateRelay()` at `:329` — `.catch(err => { revertOptimistic(prev); new Notice(err.message); })`. |
| 3.5 | `:917` host check promise — wrap `{#await hostCheck}` block with `{:catch err}<Notice/>`. |
| 3.8 | `:921` `{@html minimark(...)}` — install DOMPurify (or use existing sanitizer if one exists in Relay deps; scout dependencies first); sanitize before render. If DOMPurify unacceptable, render as text + conditional bold. |

**Acceptance**: Rapid toggle (5x in 2s) between two relays produces consistent final state, no stale token error flicker. Optimistic update rolls back on server reject. Malicious `<img src=x onerror=...>` in relay host description is rendered as text, not executed.

---

## Group E — Live Views (rows 4.2, 4.4, 4.6, 4.8, 4.9)

**Files**: `src/TextViewPlugin.ts`, `src/CanvasPlugin.ts`, `src/components/ViewActions.svelte`, `src/LiveViews.ts`
**Theme**: origin-guards on Yjs transactions, await + null-guard, sync attach, StateField cache invalidation.

| Row | Fix |
|-----|-----|
| 4.2 | `TextViewPlugin.ts:266` — skip `setViewData` when `transaction.origin === this.doc` (local echo). Guard matches 4.5 pattern. |
| 4.4 | `ViewActions.svelte:35-41` — `await view.document.diskBuffer()`; if null/undefined, `new Notice("No disk buffer available")`. |
| 4.6 | `CanvasPlugin.ts:200-220` — skip full re-import when transaction origin is our own Canvas; only re-import on remote-origin events. |
| 4.8 | `LiveViews.ts:456-461` `set tracking` — defer via `queueMicrotask(() => this.attach())` to avoid synchronous side-effect during render/event handling. |
| 4.9 | `LiveViews.ts:1263` `ConnectionManagerStateField` — rebuild StateField when a new `ConnectionManager` is created. Either: (a) key the field on manager version, or (b) replace the field wholesale on manager swap. |

**Acceptance**: Typing in remote doc doesn't cause cursor flicker; Canvas performance stays flat under rapid remote edits; tracking-toggle doesn't emit "can't attach during render" warnings; switching vaults doesn't carry an old ConnectionManager into the new editor state.

---

## Group F — Observable cleanup (row O.5)

**Files**: `src/observable/ObservableMap.ts`
**Theme**: API hygiene.

| Row | Fix |
|-----|-----|
| O.5 | `parentCallback` signature — change to `(map: ObservableMap<K, V>) => void` (or remove the ignored parameter). Document that the callback rebuilds from full map, not a delta. |

**Acceptance**: TypeScript compiles; no runtime change. Adds a `// Full rebuild, not delta` comment above the method since that's genuinely non-obvious.

---

## Execution order

1. **Group F (O.5)** first — lowest blast radius, pure type/doc change. Smoke test: `npm run build`.
2. **Group A (login)** — surgical `.catch` additions + one race fix. Manual login flow check.
3. **Group B (RelayManager)** — `Promise.allSettled` is load-bearing. Verify via Relays list load after forcing a 500 on `/api/collections/relays/records`.
4. **Group C (Relays list)** — reactive-prefix, 429, guard rewrite. Visual check on empty/loaded/throttled.
5. **Group D (ManageRelay)** — 3.1 is the headline reactivity bug. Do this before E; it will touch `$tokenStore` conventions that may inform E's StateField work.
6. **Group E (Live Views)** — origin-guards on Yjs transactions + StateField rebuild. Highest risk of regression — verify via Obsidian manual smoke on a shared doc + canvas.

Each group gets its own commit in `Relay/`. Submodule pointer bump in `Relay-monorepo/` after all six land (single bump, no need to ship each submodule update independently since no one is cutting a release mid-Phase-3c).

---

## Verification checkpoints

- **Per-commit**: `npm run build` clean; `npm run lint` clean (pre-existing warnings acceptable — do not lint-clean unrelated code in Phase 3c).
- **Per-group**: the group's acceptance criterion, exercised by hand in Obsidian.
- **Phase exit**: annotated `REACTIVITY_BUG_AUDIT.md` updated so every Phase 3c row reads `[FIXED]` with the commit SHA that closed it.

---

## Known deferred

- **4.7 Refresh queue drops jobs** — UNKNOWN verdict; needs trace of queue implementation. Moved to Phase 3d (after characterization tests in 4b give a safety net for this flow).
- **Fire-and-forget anti-patterns outside this audit** (197 findings) — Phase 4c codemod, not 3c.
- **Catch-all anti-patterns** (88 findings) — Phase 4d surgical pass, not 3c.

3c scope is ONLY the 23 verified Broken rows above.
