# RECOVERY.md — Reconstructed rationale for 9 lost fork commits

HANDOFF.md (2026-04-17) reported ~56 lost commits when `Relay/` submodule was destroyed during the submodule→in-tree migration. Post-mortem scan of Claude Code session transcripts found **9 true feature commits** plus ~51 Phase-N characterization/audit commits whose *file content* is preserved in the flatten commit `2e32ad7` (only commit-level attribution was lost).

This file captures the recovered rationale (commit bodies) + file scope for the 9 feature commits.

**Important correction to HANDOFF.md:** after the flatten, `Relay/` was rebased on clean upstream (`No-Instructions/Relay`) rather than preserving fork state. Cross-checking commit bodies against current `Relay/src` shows **~5 of the 9 fork patches are NOT in the current tree** — upstream either solves them differently or doesn't solve them at all. See the "Source-tree status per commit" table below.

### Status (2026-04-18)

Four of the five missing patches have been re-applied on top of upstream as a single "fork-unlocks" commit. Two items remain deferred:

| # | Patch | Status |
|---|---|---|
| 1 | `flags.ts` defaults flipped (6 capabilities unlocked) | ✅ applied |
| 2 | `SyncSettings.ts otherTypes.defaultEnabled: true` | ✅ applied |
| 3 | `Observable.notifyListeners` null-guard | ✅ applied |
| 4 | `creatingRelay` flag + "Creating..." button feedback | ✅ applied |
| 5 | `noStorage` unlock for unmetered self-host | 🟡 deferred — requires locating upstream's "Buy storage" UI gate to know where the getter is consumed. Per-folder toggles currently still show the paywall when `quota === 0`. |
| 6 | `leftRelayIds` tracking + post-`update()` orphan sweep in `RelayManager` | 🟡 deferred — requires careful re-reading of `_handleEvent` / `update()` flow. Realtime race after leaving a relay may re-expose. |

**Unlocked capabilities** (via `flags.ts` default flips): `enableDocumentStatus`, `enableNewLinkFormat`, `enableDocumentHistory`, `enableCanvasSync`, `enableVerifyUploads`, `enableDiscordLogin`.

The two deferred items are tracked as seeds issues:
- `Relay-monorepo-568f` — Fork-unlock: noStorage predicate for unmetered self-host
- `Relay-monorepo-b5c9` — Fork-unlock: leftRelayIds tracking + post-update() orphan sweep

Re-implement when the regressions bite in practice or when you have a session with enough scope to re-read the affected code paths thoroughly.

## Triage ranking

| Rank | Commit | Value | Reason |
|---|---|---|---|
| 1 | pb-multi-relation | HIGH | Root-cause insight: PB multi-relation arrives as `string[]` typed as `string` |
| 2 | orphan-delete-metadata | HIGH | Non-obvious null-race in Observable subscriber Sets |
| 3 | realtime-race | HIGH | `_handleEvent` re-ingest gotcha requires tracking left relay IDs |
| 4 | self-host-endpoint | MEDIUM | PB v0.22 API migration notes |
| 5 | lifecycle-bugs | MEDIUM | `permissionParents.length > 0` filter rationale |
| 6 | create-relay-button | MEDIUM | Prevents 4-orphan-in-2s duplicate-click storm |
| 7 | sync-all-types | LOW | One-line flag flips |
| 8 | per-folder-toggles | LOW | `noStorage` predicate fix |
| 9 | pb-relation-fields | SKIP | Type hygiene, no behavior |

---

## 1. pb-multi-relation

**Subject:** Fix PB multi-relation ingest + orphan-relay role throw (Relay-955f, Relay-e898)

**Session:** `e6b0ddd1` @ 2026-04-17T18:36:47Z

**Body:**
```
PocketBase multi-relation fields (maxSelect>1) arrive as string[] while DAO
interfaces typed them as string. Downstream lookups (ObservableMap.get(array))
silently failed; the invisible-relay bug was one symptom, RelayAuto role lookup
failures and shared_folder stubbing were others.

- Central normalizer at Store._ingest with PB_RELATION_FIELDS schema map
  covering shared_folders, relay_roles, shared_folder_roles, relay_invitations,
  relays, relay_subscriptions. Idempotent, applied once at the ingest funnel.
- RelayRoleAuto.get relay returns a stub instead of throwing when the relay
  is absent (matches RemoteFolderAuto). Fixes uncaught-promise cascades and
  svelte destroy errors when orphan roles reference cascade-deleted relays.
- ManageRemoteFolder.noStorage: compare roles by relayId string, not by Relay
  object identity across separate ObservableMaps (which never matched).
- createSelfHostedRelay: authStore.isValid precondition + 401 translation
  (clears authStore and surfaces "server rejected your session" instead of
  PB's opaque middleware error). Triggers when the server's JWT signing key
  rotates after a container restart.
```

**Files touched:**

- `Relay/src/RelayManager.ts` (8 edits)
- `Relay/src/components/ManageRemoteFolder.svelte` (1 edits)

---

## 2. orphan-delete-metadata

**Subject:** Orphan-relay UX: Delete metadata button + subscriber null-guards

**Session:** `e6b0ddd1` @ 2026-04-17T18:41:13Z

**Body:**
```
- ManageRemoteFolder: wire the previously-unused handleDeleteMetadata
  into the Danger zone. Lets users unlink orphan connections without
  trashing their vault folder contents (the previous only option).
- Observable.notifyListeners: skip null recipients. Subscriber Sets can
  contain nulls after unsubscribe/notify races; the send path used to
  crash on null.name inside getFunctionOrigin.
- Postie.getFunctionOrigin: belt-and-suspenders null-guard, returns
  "NullRecipient" label instead of throwing. Keeps mail logs intact
  when the primary guard misses.

Surfaced while mounting ManageRelay for orphan relays with missing
storageQuota; the mount crashed before any UI rendered, making the
"can't delete orphan relay" symptom impossible to even attempt.
```

**Files touched:**

- `Relay/src/components/ManageRemoteFolder.svelte` (1 edits)
- `Relay/src/observable/Observable.ts` (1 edits)
- `Relay/src/observable/Postie.ts` (1 edits)

---

## 3. realtime-race

**Subject:** Fix realtime race after leaving relay and auto-clean orphaned shared folders

**Session:** `8b0a0160` @ 2026-04-17T05:37:23Z

**Body:**
```
Track left relay IDs to prevent _handleEvent from re-ingesting relays
after local cascade. Clear tracking on update() which does a full re-fetch.
After update() loads all stores, cascade-delete shared folders whose relay
no longer exists on the server.
```

**Files touched:**

- `Relay/src/RelayManager.ts` (5 edits)

---

## 4. self-host-endpoint

**Subject:** Fix self-host endpoint: UUID generation, Docker networking, flags format

**Session:** `8b0a0160` @ 2026-04-17T05:30:36Z

**Body:**
```
Replace $app.dao().generateId() with $security.randomString() (PB v0.22).
Generate proper UUIDs for relay GUIDs. Add Docker ping fallback for
container-to-container networking. Fix flags endpoint to return [] not {}.
Volume-mount pb_hooks for dev iteration.
```

---

## 5. lifecycle-bugs

**Subject:** Fix relay lifecycle bugs: creation routing, list filtering, and reactivity guards

**Session:** `8b0a0160` @ 2026-04-17T05:30:33Z

**Body:**
```
Route all relay creation through self-host endpoint (raw PB API lacked
creator/supporting records). Filter relay list by permissionParents.length > 0
to exclude deleted/left relays. Add loaded guards to prevent empty-state
flashes during async PocketBase loads. Remove dead createRelay() method
and debug logging.
```

**Files touched:**

- `Relay/src/components/PluginSettings.svelte` (1 edits)
- `Relay/src/RelayManager.ts` (1 edits)

---

## 6. create-relay-button

**Subject:** Create-relay button: disable + "Creating..." feedback (Relay-598d)

**Session:** `e6b0ddd1` @ 2026-04-17T18:36:54Z

**Body:**
```
PluginSettings.handleCreateRelayEvent now flips a creatingRelay flag
true/false around the async createSelfHostedRelay + update call, passed
down to Relays.svelte as a prop. Button becomes disabled with "Creating..."
label during the POST, preventing the duplicate-click orphan accumulation
observed in prior session (4 orphan relays in <2s).

Drive-by: drop the {providers} prop that PluginSettings was passing to
Relays but Relays never declared — TS re-surfaced it after adding the
new prop.
```

---

## 7. sync-all-types

**Subject:** Sync settings: enable all file types by default + always-sync canvas

**Session:** `e6b0ddd1` @ 2026-04-17T18:57:22Z

**Body:**
```
- otherTypes.defaultEnabled: false -> true. The otherTypes category is
  the catch-all fallthrough at isExtensionEnabled line 100, so flipping
  its default makes sync genuinely allow-all out of the box instead of
  silently dropping unknown extensions.
- .canvas always syncs; remove flags().enableCanvasSync gate. The feature
  flag was gating a stable feature.
```

**Files touched:**

- `Relay/src/SyncSettings.ts` (2 edits)
- `Relay/src/HasProvider.ts` (1 edits)

---

## 8. per-folder-toggles

**Subject:** Unlock per-folder sync toggles on unmetered self-hosted storage

**Session:** `e6b0ddd1` @ 2026-04-17T18:58:49Z

**Body:**
```
noStorage previously evaluated to true whenever storageQuota.quota === 0,
which locked the per-category sync toggles (Images / Audio / Video / PDF)
with a Lock icon and "Buy storage" CTA.

On self-hosted relays, the relay_mgmt.pb.js handler creates the storage
quota with quota=0 AND metered=false — meaning "BYO unmetered storage"
(per the README self-host model), not "no plan purchased". The lock
should only trigger when quota=0 AND metered=true.

Result: toggles remain interactive on self-hosted folders. No change for
cloud (metered) users.
```

**Files touched:**

- `Relay/src/components/ManageRemoteFolder.svelte` (1 edits)

---

## 9. pb-relation-fields

**Subject:** PB_RELATION_FIELDS: readonly string[] values

**Session:** `e6b0ddd1` @ 2026-04-17T18:51:06Z

**Body:**
```
typescript-pro lens improvement — Record<string, readonly string[]> signals
the arrays are not meant to be mutated at runtime. No behavior change.
```

**Files touched:**

- `Relay/src/RelayManager.ts` (2 edits)

---

## Upstream comparison notes

The upstream `No-Instructions/Relay` codebase already ships most infrastructure the fork sat on top of. The 9 lost fork commits were **modifications / bug-fixes / UX tweaks on top of upstream features**, not re-implementations of them.

### Upstream-native (already present in current `Relay/src` — fork did NOT build these)

| Capability | Upstream location |
|---|---|
| Self-host server URL customization | `src/ui/SelfHostModal.ts`, `src/components/SelfHostModalContent.svelte` |
| Custom OAuth / auth flow | `src/LoginManager.ts`, `src/pocketbase/LocalAuthStore.ts`, `src/components/LoggedIn.svelte` |
| File-storage allow (sync category toggles) | `src/SyncSettings.ts` (schema + defaults) |
| Relay orchestration wiring (permissionParents tuple typing) | `src/RelayManager.ts` uses `[string, string][]` tuples — structurally different from fork's `PB_RELATION_FIELDS: readonly string[]` approach |
| `handleDeleteMetadata` for orphan shared-folders | `src/components/ManageRemoteFolder.svelte:197`, `ManageSharedFolder.svelte:16,64` |
| Cascade-delete primitive | `src/RelayManager.ts:992 cascade(...)` |
| `handleCreateRelayEvent` wiring | `src/components/PluginSettings.svelte:171,317` |
| Control-plane integration (pb_hooks, `/doc/:id/auth`, ClientToken) | Preserved in `relay-control-plane/` subtree (survived the incident via /tmp backup) |

### Source-tree status per commit

Verified by greps against current `Relay/src` on 2026-04-18:

| # | Commit | Status in tree | Notes |
|---|---|---|---|
| 1 | pb-multi-relation | **PARTIAL** | Upstream uses `[string, string][]` tuple typing which avoids the `string` vs `string[]` class of bug entirely. Fork's `PB_RELATION_FIELDS` pattern not present; likely redundant now. |
| 2 | orphan-delete-metadata (UX wiring) | **PRESENT** | `handleDeleteMetadata` wired in both `ManageRemoteFolder.svelte` and `ManageSharedFolder.svelte`. |
| 2b | orphan-delete-metadata (Observable null-guard) | **MISSING** | `src/observable/Observable.ts:46 notifyListeners()` iterates `_listeners` with no null filter. The null-race fix is NOT in-tree — re-implement if subscriber-null crashes reappear. |
| 3 | realtime-race (leftRelayIds tracking) | **MISSING** | No `leftRelay` / `_leftRelayIds` in `src/RelayManager.ts`. Post-`update()` orphaned-shared-folder sweep also absent (`cascade()` exists only as a per-event primitive, not a post-update sweep). |
| 4 | self-host-endpoint | **UPSTREAM** | PB v0.22 API shape is upstream-compatible; fork patches were interim during PB upgrade. |
| 5 | lifecycle-bugs | **PRESENT** | `permissionParents.length > 0` filter visible at `RelayManager.ts:1426`. Loaded-guards and routing already upstream. |
| 6 | create-relay-button (`creatingRelay` flag + "Creating..." feedback) | **MISSING** | No `creatingRelay` prop/flag in `PluginSettings.svelte` or `Relays.svelte`. Duplicate-click orphan storm regression is re-exposed. |
| 7 | sync-all-types (defaults flipped) | **MISSING** | `src/flags.ts:28 enableCanvasSync: false` (fork wanted `true`). `src/SyncSettings.ts:60 otherTypes.defaultEnabled: false` (fork wanted `true`). Both reverted by upstream rebase. |
| 8 | per-folder-toggles (`noStorage` predicate) | **MISSING** | No `noStorage` getter / quota===0 gating in source. Self-host users see "Buy storage" CTA where fork had unlocked per-category toggles. |
| 9 | pb-relation-fields | **N/A** | Pure type hygiene on the `PB_RELATION_FIELDS` constant, which no longer exists in-tree. Redundant against upstream's tuple approach. |

### The actual gating mechanism (upstream locks)

The fork's defaults-flipping isn't cosmetic — it neutralizes upstream's server-side feature gating:

- `src/flagManager.ts:applyServerFlags(serverFlags)` filters `serverFlags` by `flag.override === true` and merges them over local `FeatureFlagDefaults`.
- Upstream-hosted PocketBase pushes override flags per subscription tier. Free-tier or unsubscribed users get mostly-`false` overrides; paying users get `true`.
- Self-hosted PB sends no override payload → local defaults stand → every flag with `FeatureFlagDefaults.*: false` appears "locked" to self-hosters.

**Current `FeatureFlagDefaults` (upstream `Relay/src/flags.ts`):**
```
enableDocumentStatus: false   enableNewLinkFormat: false
enableDeltaLogging: false     enableDocumentHistory: false
enableEditorTweens: false     enableNetworkLogging: false
enableCanvasSync: false       enableVerifyUploads: false
enableAutomaticDiffResolution: true
enableDiscordLogin: false     enableSelfManageHosts: true
enableToasts: true            enablePresenceAvatars: true
enableLiveEmbeds: true        enablePreviewViewHooks: true
enableMetadataViewHooks: true enableKanbanView: true
```

**Capabilities upstream leaves locked-by-default (need fork overrides for self-host):**
- `enableCanvasSync` — gated canvas sync
- `enableDocumentHistory` — doc history UI
- `enableDocumentStatus` — per-doc status indicators
- `enableNewLinkFormat` — link rendering
- `enableDiscordLogin` — OAuth provider (ironic for a self-host)
- `enableVerifyUploads` — integrity checks
- `enableEditorTweens` / `enableDeltaLogging` / `enableNetworkLogging` — dev/observability

Plus sync-category and storage gating which aren't flag-driven but behave similarly:
- `SyncSettings.otherTypes.defaultEnabled: false` — fallthrough drops unknown extensions
- `noStorage` predicate (absent upstream) — "Buy storage" CTA triggers on `quota === 0`, which every self-host hits

**Every `git subtree pull --prefix=Relay relay-upstream main` will re-lock these.** The fork's 9 commits were, effectively, a post-pull unlock patch set.

### Re-implementation priority (for when you need these back)

1. **`enableCanvasSync: true` + `otherTypes.defaultEnabled: true`** — one-line flips in `src/flags.ts` and `src/SyncSettings.ts`. 30-second fix; high user-visible impact.
2. **`noStorage` unlock for unmetered self-host** — add a getter that returns `false` when `metered === false` regardless of quota, gate the "Buy storage" CTA on it.
3. **`creatingRelay` flag in `PluginSettings.svelte`** — toggle around the async create call, pass as prop to `Relays.svelte`, disable button + show "Creating...". Prevents the 4-orphan-in-2s regression.
4. **Observable null-guard in `notifyListeners`** — filter nulls in the `for` loop. Defensive; cheap.
5. **`leftRelayIds` tracking + post-`update()` orphan sweep in `RelayManager`** — highest effort; needs re-reading how `_handleEvent` ingests realtime events to reinstate.

The vault-preserved compiled bundle at `release-assets/v0.7.5/main.js` already contains all five — but as minified output, not source. Users running the plugin won't regress; anyone rebuilding from source will.

### Recommended: persistent "unlock patch" file

Rather than hand-flipping each upstream pull, consolidate fork overrides into one patch that's applied post-subtree-pull:

1. Create `Relay/fork-unlocks.patch` or a `postinstall` script that runs after `git subtree pull --prefix=Relay`.
2. Candidate unlock set — flip these defaults in `src/flags.ts` + ad-hoc fixes:
   ```
   enableCanvasSync: true
   enableDocumentStatus: true
   enableDocumentHistory: true
   enableNewLinkFormat: true
   enableDiscordLogin: true
   enableVerifyUploads: true
   ```
   Plus:
   ```
   src/SyncSettings.ts: otherTypes.defaultEnabled = true
   src/RelayManager.ts: noStorage getter returns metered===false ? false : (quota===0)
   src/observable/Observable.ts: notifyListeners filters null recipients
   src/components/PluginSettings.svelte: creatingRelay flag around async create
   src/RelayManager.ts: _leftRelayIds tracking + post-update() orphan sweep
   ```
3. Alternative (cleaner): short-circuit `applyServerFlags` when `pb.baseUrl` is non-upstream — treat self-host as "all overrides true." One-liner in `flagManager.ts`, survives default-drift upstream.
