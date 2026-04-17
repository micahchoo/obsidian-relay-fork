# Phase 0 — Control Plane Security Plan

**Spec reference:** `docs/specs/2026-04-17-relay-pipeline-repair-design.md` § "Phase 0 — Stop the bleeding"
**Scope:** `relay-control-plane/pb_hooks/*.pb.js` + `docker-compose.yml`
**Target:** one PR, ~55–70 LOC across 5 files, no data migration
**Status:** pre-flight — 6 uncertainties dispatched to W2 scout; resolve before implementation

## Pre-flight: uncertainties — RESOLVED by W2 scout

| # | Question | Answer | Evidence | Effect on plan |
|---|----------|--------|----------|----------------|
| 1 | `$security.hs256` available? | **YES** | `relay-control-plane/data/types.d.ts:595`, interface `:2907-2911` | Safe to use for hash-derived IDs if needed |
| 2 | `randomString(n)` default alphabet? | `[A-Za-z0-9]+` — URL-safe | `types.d.ts:2977-2983` (JSDoc: "transparent to URL-encoding") | Invitation keys at `relay_mgmt.pb.js:126, :249` are fine as-is. **Item 3 sub-task dropped.** |
| 3 | Admin auth primitive? | `$apis.requireAdminAuth()` (idiomatic); no `admin` field on `users` | `types.d.ts:974-975` (`requireAdminAuth`, `requireAdminAuthOnlyIfAny`); `pb_migrations/1_init.js` — no admin field | **Item 5:** use `$apis.requireAdminAuth()` as middleware. No schema migration. Single-PR path confirmed. |
| 4 | `collectionName` actually read? | **YES, blocking** | `Relay/src/RelayManager.ts:963` — `this.collections.get(record.collectionName)` in `_ingest()` | **Item 4 is NOT decorative.** Must annotate expand children before return. |
| 5 | Healthcheck: hostname or path? | **Path.** `/api/health` not registered; only `/health` exists | `docker-compose.yml:11` hits `/api/health`; `misc.pb.js:14` registers `/health` | **Item 1:** fix compose to `http://localhost:8090/health` (or register `/api/health` alias). Localhost inside container is fine. |
| 6 | OAuth state plugin-side lookup? | By **record ID** = `state.slice(0, 15)` | Plugin: `Relay/src/LoginManager.ts:582` (`.getOne(state.slice(0,15))`); server: `misc.pb.js:84` (`rec.setId(state.slice(0, 15))`) | **Item 2 must ship a paired plugin change** if ID derivation changes. Safer option: don't change derivation; only add validation that full `state` field round-trips unchanged (which it already does at `:86`). Downgrade Item 2 to: add a uniqueness constraint + alert on collision, rather than re-derive. |

**Plan status:** all 6 uncertainties resolved. Items 1, 3, 4, 5, 6 are safe for single-PR. Item 2 scope reduced — see revised description below.

## Implementation items (ordered by risk, smallest first)

### Item 1 — Docker healthcheck *(RESOLVED: path bug)*
- **File:** `relay-control-plane/docker-compose.yml:11`
- **Current:** `test: ["CMD", "wget", "-q", "--spider", "http://localhost:8090/api/health"]`
- **Change:** replace `/api/health` with `/health` (endpoint registered at `misc.pb.js:14`). Localhost inside container is fine.
- **Test:** `docker compose up && docker inspect --format='{{.State.Health.Status}}' <container>` → `healthy` within 40s.
- **Risk:** trivial. 1-line change.

### Item 2 — OAuth state collision protection *(RESOLVED: scope reduced)*
- **Files:** `relay-control-plane/pb_hooks/misc.pb.js:84`; no plugin change needed.
- **Finding:** plugin polls by record ID = `state.slice(0, 15)` at `Relay/src/LoginManager.ts:582`. Re-deriving ID on server would break lookup unless plugin is updated in the same PR — deferred.
- **Change (scope-reduced):** keep current ID derivation. Add: (a) log a warning when a collision would occur (try `.getOne(id)` before create; if found, log + return 409 rather than overwrite); (b) assert full `state` round-trip integrity — the `state` field is already saved unmodified at `:86`, verify the plugin validates the full state after token exchange. If plugin does not validate, file a seeds issue (Phase 3 territory).
- **Test:** rapidly start 2 OAuth flows whose 15-char prefix collides; assert the second returns 409 and the first completes cleanly.
- **Risk:** contained to server. No plugin change.

### Item 3 — UUID generation
- **File:** `relay-control-plane/pb_hooks/relay_mgmt.pb.js:88-89`
- **Bug confirmed by plan scout:** current splice produces **35 chars, not 36**. `hex.slice(13,16)` drops an index; should be `hex.slice(12,15)` and tail extended.
- **Change:**
  ```
  const hex = $security.randomStringWithAlphabet(32, "0123456789abcdef")
  const y   = "89ab"[Math.floor(Math.random()*4)]
  const guid = hex.slice(0,8)+"-"+hex.slice(8,12)+"-4"+hex.slice(12,15)+"-"+y+hex.slice(15,18)+"-"+hex.slice(18,30)
  ```
- **Test:** `curl POST /api/collections/relays/self-host`; DB `guid` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`.
- **Risk:** small — plugin regex at `src/S3RN.ts:128-132` validates this exact format.
- **Lines 126 and 249** (invitation keys): *RESOLVED.* Default `randomString` alphabet is `[A-Za-z0-9]+` (URL-safe per `types.d.ts:2977-2983`). **Leave as-is.**

### Item 4 — `collectionName` on expand children *(RESOLVED: blocking bug)*
- **Files:** `relay_mgmt.pb.js:135` (primary); `token.pb.js` / `file_token.pb.js` likely N/A (those return tokens, not PB records — re-inspect).
- **Finding:** `Relay/src/RelayManager.ts:963` reads `record.collectionName` to route expanded children to the correct `Collection` class. Missing field means plugin silently drops the child record during `_ingest()`. This is the root cause of HANDOFF.md's "Store.ingest only processes top-level records" observation.
- **Change:** after `expandRecord(relay, [...])` in `relay_mgmt.pb.js`, walk each child and ensure `collectionName` is present on the serialized JSON. PB's default `Record.toJSON()` should include it; if the return path uses `c.json(200, relay)` and expand children are wrapped Record instances, they serialize correctly. If they're plain objects (from custom marshaling), explicitly set `child.collectionName = "<name>"` before return.
- **Test:** `curl ... /self-host | jq '.expand.relay_invitations_via_relay[0].collectionName'` → `"relay_invitations"`; similarly for `relay_roles_via_relay`.
- **Risk:** medium — fix depends on whether the current return uses Record JSON or custom object. Implementer must verify at edit time.

### Item 5 — Gate `/api/superuser/*` *(RESOLVED: requireAdminAuth)*
- **File:** `relay-control-plane/pb_hooks/misc.pb.js:131, 162, 178` (three routes; re-verify line numbers at edit time and add any other `/api/superuser/*` routes found in the same file).
- **Finding (W2.Q3):** `$apis.requireAdminAuth` exists (`types.d.ts:974-975`); targets `_superusers` collection. `users` has no `admin` field (`pb_migrations/1_init.js`) — custom flag path is not needed.
- **Change:** add third arg to each `routerAdd(...)` as `$apis.requireAdminAuth()`. No schema migration.
- **Test:**
  - `curl http://localhost:8090/api/superuser/oauth` → 401
  - `curl -H "Authorization: Bearer <user-token>" ...` → 401/403
  - `curl -H "Authorization: Bearer <admin-superuser-token>" ...` → 200
- **Risk:** low. Single-line change per route. Single-PR path confirmed.

### Item 6 — Try/catch + logging on silent paths
- **Files:** `token.pb.js` (wrap handler body), `file_token.pb.js` (wrap handler body + replace empty `catch (_) {}` at :35), `relay_mgmt.pb.js:178-224` (`/accept-invitation`)
- **Change:** wrap entire handler bodies in `try { ... } catch (err) { console.log("[endpoint] FAILED:", err.message, err.stack); return c.json(500, {error: err.message}) }`.
- **Test:** break a relay provider row, call `/token`, confirm log line emitted and client gets 500 (not PB default swallow).
- **Risk:** negligible — only changes observability, not contract.

## PR grouping

**Recommended: single PR for items 1–6.** All in `pb_hooks/` + `docker-compose.yml`, all <150 LOC, all reviewable together. Spec Locked Decision #4 mandates Phase 0 ships as one PR.

**Fallback (single-PR no longer requires split):** item 5 confirmed to use `$apis.requireAdminAuth()` (no schema migration). Single PR is the default path.

## Rollback

Hot path: `git revert <phase-0-sha>` + `docker compose up -d --build control-plane`. 30s window. No data migration, no schema change, no client redeploy.

Partial rollback: item 2 alone can be reverted if OAuth collision-protection regresses; other items are independent.

## Acceptance (closes Phase 0)

- All 3 `/api/superuser/*` routes reject unauthenticated requests (curl in PR description).
- New relay `guid` matches UUID v4 regex (plugin validation passes).
- OAuth state is not truncated; collision case tested.
- Docker container reports `healthy` status.
- `/token`, `/file-token`, `/accept-invitation` return 500 with error body on server failure (no silent swallow).
- `git diff --stat` ≤ 100 LOC.
