# Relay Fork Pipeline Repair — Design Spec

**Date:** 2026-04-17
**Scope:** `Relay/` plugin + `relay-control-plane/` server
**Source of truth for prior art:** `REACTIVITY_BUG_AUDIT.md`, `HANDOFF.md`, `anti-pattern-report.txt` (429 findings)

---

## Intent

Return the Relay fork to an end-to-end working state: login → create relay → share folder → live edit → leave → reopen, with no orphaned entities, no stuck loading states, no silent reactivity failures, no security exposures, and a test surface sufficient to prevent regression.

The fork was cut from `Source/` to remove proprietary auth/infra and self-host PocketBase. Diagnostic scouting revealed that **73% of the debt pre-existed in `Source/`**; the fork revealed it rather than causing it. Repair strategy is therefore structural, not "undo the cut."

## Requirements

1. Golden path works end-to-end without manual recovery steps.
2. No endpoint on the control plane mutates state without authentication/authorization appropriate to the resource.
3. Reactivity substrate is deterministic: no frozen transaction state, no unbounded listener accumulation, no stale-loading UI.
4. Lifecycle operations (create/leave/destroy/share/unshare) are recoverable: either complete successfully or leave local state consistent with server state.
5. Live collaboration connections fail loudly and recover: no indefinite hangs, no silent drops, no phantom cursors wiping local selections.
6. Test harness exists for the five hotspot files such that characterization tests can be written and run in CI.
7. Fire-and-forget promises surface failures to logs; silent-catch handlers either re-throw typed errors or notify the user.

## Constraints

- `Source/` is frozen; no merge-back obligation. Refactors may diverge structurally from Source.
- PocketBase v0.22 JSVM: no `$app.dao().generateId()`; use `$security.randomStringWithAlphabet()` with proper UUID formatting; container→container URLs must be service names, not `localhost`.
- Plugin runs inside Obsidian; tests cannot assume Node-only APIs. Test harness must mock `Vault`, `Editor`, `MarkdownView`, `TextFileView`, `CanvasView`.
- Control plane and relay server are separate Docker services; networking contracts are service-name-based.
- Repair must ship in vertical slices (phases), not one mega-PR.

## Locked Decisions

1. **Observable layer is repaired in place, not replaced.** Serves R3. Rules out: migration to Svelte stores, Solid signals, or Nanostores. Rationale: scout #1 found only 1 leaky `filter()` call site in production, `setLoaded()` already notifies correctly (commits `f568e99`/`41b6460`/`e4833bf`), and Postie's transaction bug is guardable with a single internal wrapper. Blast radius of replacement exceeds the bug surface.

2. **Five-phase sequencing: 0→Security, 1→Substrate, 2→Lifecycle, 3→Flow surgery, 4→Hygiene.** Serves R1–R7. Rules out: parallel shotgun across all 429 findings; top-down rewrite; pure bug-triage without structural fixes. Rationale: security must ship first because `/api/superuser/*` is publicly mutable. Substrate must precede lifecycle because lifecycle fixes build on trusted reactivity. Lifecycle must precede flow surgery because per-flow bugs often inherit from lifecycle misbehavior. Hygiene lands last because it requires the test harness.

3. **Obsidian mock harness is a Phase 4 prerequisite, built once and reused.** Serves R6. Rules out: skipping tests for hotspot files, or mocking per-test. Rationale: the five hotspot files (SharedFolder 29, RelayManager 20, LiveViews 19, main 16, SyncFile 15) concentrate 99 anti-patterns, and all couple to Obsidian APIs. Per-test mocks would duplicate ~200 lines across suites.

4. **Security fix (Phase 0) ships as its own PR, before any other work.** Serves R2. Rules out: bundling security with reactivity fixes. Rationale: zero-day disclosure window. Control plane PR reviewable in isolation.

5. **Characterization tests precede refactoring in Phase 4.** Serves R6. Rules out: refactoring fire-and-forget sites without safety net. Rationale: 197 fire-and-forget sites + 88 catch-all sites across mostly-untested code. Mechanical conversion without characterization tests is a mass regression risk.

6. **Source-compatibility is not a refactor constraint.** Rules out: preserving Source's function signatures, file structure, or architectural choices where they are load-bearing for the debt. Rationale: user confirmed Source frozen.

7. **Both repos (`Relay/` + `relay-control-plane/`) are in scope.** Rules out: control-plane-later. Rationale: Phase 0 security straddles both; Phase 2 lifecycle has server-side pair requirements (e.g., `leaveRelay` needs server to honor the cascade contract).

## Not Doing

- **Full rewrite of the observable layer.** Locked Decision 1 excludes this; deferred indefinitely unless future evidence inverts the blast-radius calculation.
- **Backporting fixes to `Source/`.** Source is frozen (user-stated).
- **Migrating off PocketBase.** Infrastructure is given.
- **UI redesign.** Repair is behavioral, not visual.
- **Replacing Yjs or YSweet.** Collaboration layer couples tightly but works; repair in place.
- **Billing/telemetry restoration.** Deliberately removed during de-proprietization.
- **Full anti-pattern sweep to zero findings.** Phase 4 targets the 5 hotspots + mechanical fire-and-forget conversion; residual debt in cold files is acceptable.
- **Addressing `untested-churn` (19 findings) outside the 5 hotspots.** Deferred.

## Open Questions

**Blocking (must resolve before implementation):**
- **Phase 2:** For `destroyRelay` / `leaveRelay`, is the acceptance contract "server-ack before cascade" (slower UX, safer) or "optimistic with compensating rollback" (faster UX, more code)? Default: server-ack before cascade, since this is admin-rare, not hot-path.
- **Phase 4:** Target coverage threshold for the 5 hotspots — 80% line? 100% branch on the fire-and-forget sites? Default: 80% line, 100% of `.catch()` / error paths.

**Exploratory (resolve during implementation):**
- Can Postie's internal try/finally be made fully safe without changing call sites, or do RelayManager's `beginTransaction` / `commitTransaction` callers need a matching wrapper (defense in depth)?
- Does `onceConnected`'s 30s timeout break any legitimate slow-connect scenario? (Probably not — YSweet typically sub-second.)
- Is `/api/superuser/*` used by any legitimate internal workflow, or can it be fully gated behind admin auth? (Read scout #4 context: appears to be a misplaced config shim.)
- Mechanical `.catch(logError)` conversion: does a codemod exist, or do we build one? (`jscodeshift` + tiny AST transform on `src/**/*.ts`.)

## Approaches Considered

**A. In-place phased repair** *(chosen)*
Preserve the existing architecture. Ship five phases in order. Blast radius per PR is small, risk is localized, golden path returns to health incrementally.
- Pros: low risk; each phase independently shippable; audit doc maps directly to phase 3 work; user sees progress early.
- Cons: 5 PRs minimum; carries some inherited debt forward until phase 4 lands.

**B. Big-bang rewrite of the reactivity substrate + state management**
Replace `ObservableMap`/`ObservableSet`/`Postie` with Svelte stores (or Nanostores). Rebuild lifecycle on top.
- Pros: resolves many bugs by construction; aligns with Svelte idioms; test surface easier.
- Cons: scout #1 rejected this on blast-radius; touches all consumers of the generic `ObservableMap<K,V>` DAO pattern; weeks of work before anything works again; high regression risk.

**C. Triage-only (no structural fixes)**
Work the 29 audited bugs one at a time, skip hygiene, skip test harness. Ship when audit is closed.
- Pros: fastest path to "audit complete."
- Cons: 73% of debt remains; reactivity substrate stays fragile; next session repeats this one. User explicitly chose "full hygiene" (option C), which rules this out.

**Chosen: A.** Rationale: matches user's full-hygiene scope while respecting the observable-layer finding that replacement is unnecessary. Each phase closes a risk category end-to-end before the next starts, so progress is concretely demonstrable.

## Flow Map

**Flow:** user opens Obsidian with Relay plugin → authenticates → creates/joins a relay → shares a folder → edits a document collaboratively → leaves → reopens
**Observable trigger:** plugin load → user clicks "Create Relay" or OAuth flow start
**Observable outcome:** relay appears in list, folder appears as shared, edits sync bidirectionally, leaving removes relay from list without orphans, reopening restores prior state cleanly

### Path (annotated with change sites)
1. `src/LoginManager.ts` — **[CUT SEAM]** auth flow; cut proprietary providers
2. `src/RelayManager.ts` — **[CHANGE SITE / HOTSPOT]** create/leave/destroy/update; 20 anti-patterns
3. `src/SharedFolder.ts` — **[CHANGE SITE / HOTSPOT]** share/bind/unbind; 29 anti-patterns; `set remote` leak
4. `src/LiveViews.ts` — **[HOTSPOT]** Yjs attach/detach; 19 anti-patterns
5. `src/HasProvider.ts` — **[CHANGE SITE]** `onceConnected` can hang
6. `src/RemoteSelections.ts` — **[CHANGE SITE]** awareness leak on reconnect; out-of-range cursor bug
7. `src/observable/*` + `src/Postie.ts` — **[SUBSTRATE]** underlies every node above
8. `relay-control-plane/pb_hooks/relay_mgmt.pb.js` — **[CHANGE SITE]** self-host endpoint, UUID generation
9. `relay-control-plane/pb_hooks/*.pb.js` — **[CHANGE SITE / SECURITY]** `/api/superuser/*` unauthenticated

### Upstream contract (plugin ← control plane)
- OAuth token exchange, subscription token, relay records (with `expand` children), realtime events
- `creator` field must be set on relay create; `permissionParents` must be loaded before filter runs
- Relay server reachable at `relay-server-sh:8080` from container; client talks to control plane at `:8090`

### Downstream contract (plugin → Obsidian)
- Svelte stores render relay list, folder list, manage view
- Editor bindings (TextViewPlugin, CanvasPlugin) attach Y.Doc to active file
- No `{@html}` without sanitization (bug 3.8)

### Depth justification
Standard tier (flow map from architecture knowledge). Architecture docs absent; map produced from scout synthesis. Escalation to Deep (codebase-diagnostics) not needed — scouts already produced the equivalent output.

## Phase plan (ordering + scope)

### Phase 0 — Stop the bleeding (control plane security)
**PR scope:** `relay-control-plane/` only.
- Gate `/api/superuser/*` (GET + POST) behind `$apis.requireRecordAuth()` with admin role check.
- Fix non-UUID generation in `relay_mgmt.pb.js:88-89` (manual splice), `:126`, `:249`, and OAuth state truncation at `:oauth2-redirect`.
- Add `collectionName` to returned expand records in `relay_mgmt.pb.js:135`, `token.pb.js:87-88`, `file_token.pb.js:83-88`.
- Add try/catch + logging to `/token`, `/file-token`, `/accept-invitation` silent paths.
- Fix Docker healthcheck hostname.

### Phase 1 — Reactivity substrate hardening
**PR scope:** `Relay/src/Postie.ts`, `Relay/src/observable/*`, `Relay/src/SharedFolder.ts`, `Relay/src/components/ManageRelay.svelte`.
- Harden `Postie.commitTransaction` with internal try/finally; ensure `isInTransaction` can never remain true across a thrown exception.
- Bug 2.6: `SharedFolder.set remote` — unsubscribe old relay before appending new subscription; clear stale entries in `unsubscribes` array.
- Bug 3.9 / O.4: replace inline arrow predicate at `ManageRelay.svelte:954` with a stable module-level predicate or convert to `derived()` Svelte store. Cache by ID, not function reference.
- Bug O.2: `SharedFolder.Files` calls `super.add()` instead of bypassing to `this._set.add()`.
- Bug O.3: move `DerivedMap` eager population from constructor to first `subscribe()`.
- Dev-only leak detection: instrument `Observable.notifyListeners` to count listener adds/removes, warn if set grows monotonically past threshold.

### Phase 2 — Lifecycle transactionality
**PR scope:** `Relay/src/RelayManager.ts`, `Relay/src/HasProvider.ts`, `Relay/src/RemoteSelections.ts`, `Relay/src/LiveViews.ts`; paired server changes in `relay-control-plane/pb_hooks/` if cascade contracts need adjusting.
- Bug 3.6: `destroyRelay` / `leaveRelay` — server-ack before local cascade. Acceptance: if server call fails, local state unchanged and user sees an error.
- Bug 4.10: `HasProvider.onceConnected` — add 30s timeout; reject with typed error on timeout or provider `destroy`.
- Bug 4.5: `RemoteSelections` — store awareness listener ref; `.off()` before re-attach on reconnect.
- Bug 4.12: `LiveViews.clearViewActions` — call `this._viewActions?.$destroy()` before DOM removal.
- Bug 4.1: `RemoteSelections` out-of-range cursor — bounds-check before applying; keep local selections intact.

### Phase 3 — Per-flow surgery
**PR scope:** one PR per flow (1, 2, 3, 4) from the audit.
- Work remaining audited bugs in audit order within each flow.
- User-facing feedback added wherever a silent rejection previously existed.
- `getSubscriptionToken` (bug 3.2): compare response body correctly; the current `!== 200` check on the JSON body is the wrong shape.
- `leaveRelay` collection name (bug 3.7): verified fixed; add regression test.
- Login flow silent rejections (1.3–1.8): `.catch` + typed re-throw + user notice.
- Canvas full-reimport (4.6): diff YMap events, apply minimal update.

### Phase 4 — Hygiene at scale (test-first)
**PR scope:** multiple PRs in sequence.
1. **Obsidian mock harness:** mock `Vault`, `Editor`, `MarkdownView`, `TextFileView`, `CanvasView`, `Notice`, `TFile`. Publishable as `__tests__/obsidian-mocks.ts` consumed by all suites.
2. **Characterization tests** for the 5 hotspots (SharedFolder, RelayManager, LiveViews, main, SyncFile), targeting 80% line coverage and 100% error-path coverage.
3. **Codemod run:** mechanical `.catch(logError)` insertion on 197 fire-and-forget sites. Script lives in `scripts/codemods/fix-fire-and-forget.js`.
4. **Surgical pass** on 88 catch-all sites: replace with typed error branches or re-throws; no silent returns.
5. **Delete dead code:** `createRelay` at `RelayManager.ts:2007-2042` (called out in HANDOFF), stale `! Copy N` local entries cleanup.

## Referenced Documents

- `/mnt/Ghar/2TA/DevStuff/Relay-monorepo/Relay/REACTIVITY_BUG_AUDIT.md` — source of truth for the 29 audited reactivity bugs
- `/mnt/Ghar/2TA/DevStuff/Relay-monorepo/Relay/HANDOFF.md` — prior-session fix log, lists already-fixed items and failed approaches (notably: `leaveRelay` typo already fixed; `update()` force-sync after relay creation)
- `/mnt/Ghar/2TA/DevStuff/Relay-monorepo/Relay/anti-pattern-report.txt` — 429 findings categorized by cluster
- `/mnt/Ghar/2TA/DevStuff/Relay-monorepo/Relay/RELAY-MONOREPO-HANDOFF.md` (via parent dir) — cross-repo handoff context

## Traceability

**RXS (requirement → solution coverage):**

| Req | Phase addressing | Status |
|-----|------------------|--------|
| R1 golden path | 2, 3 (lifecycle + flow bugs) | Addressed |
| R2 auth on endpoints | 0 | Addressed |
| R3 deterministic reactivity | 1 | Addressed |
| R4 lifecycle recoverability | 2 | Addressed |
| R5 live collab fails loudly | 2, 3 flow 4 | Addressed |
| R6 test harness for hotspots | 4 | Addressed |
| R7 surfaced async failures | 3, 4 codemod | Addressed |

**SXR (solution → requirement anchor):** every phase item above traces to at least one R. Orphan-detection machinery (already landed pre-session) is treated as context, not new scope.

## Implementation routing

After spec approval:
- **Phase 0** → `writing-plans` immediately (smallest, highest urgency).
- **Phase 1** → `writing-plans` after Phase 0 merges.
- **Phase 2** → `writing-plans` with `test-driven-development` locked-in for new contracts.
- **Phase 3** → `writing-plans` per sub-flow.
- **Phase 4** → `writing-plans` for harness first, then sub-PRs routed individually.

The five-phase structure satisfies the "3+ independent subsystems → `dispatching-parallel-agents`" post-spec route for phase 4 only (mock harness + characterization tests for five hotspots can parallelize once the harness lands).

## Success bar (closes the spec)

- Golden path manually verified green
- `/api/superuser/*` rejects unauthenticated requests (curl test in PR)
- `grep -r "notifyListeners"` shows no unreachable paths; Postie dev assertion quiet
- 5 hotspot files each show ≥80% coverage in `jest --coverage`
- Fire-and-forget findings: <50 remaining (from 197)
- Audit doc `REACTIVITY_BUG_AUDIT.md` has every row annotated "Fixed in <commit>" or "Deferred: <reason>"
