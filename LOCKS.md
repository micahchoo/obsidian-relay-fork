# LOCKS.md — Upstream feature gates inventory

Trace of every mechanism in `Relay/src/` and `relay-control-plane/pb_hooks/` that gates, limits, or paywalls behaviour. Covers both the locks already unlocked by the fork (see RECOVERY.md) and the locks still present.

Status legend:
- **UNLOCKED** — patch already landed on master
- **BLOCKER** — still active, blocks real functionality for self-host users
- **COSMETIC** — still active, only affects UI labels/buttons; functional flow works
- **LATENT** — conditional on server data that self-host never has; safe no-op

---

## 1. `FeatureFlagManager.applyServerFlags` — **UNLOCKED** (commit `4e1f063`)

`src/flagManager.ts:50` merges server-pushed `{name, value, override:true}` flags over local defaults. Upstream-hosted PB pushes tier-keyed overrides; self-host PB sends nothing so local defaults stand. Fork unlock: flip 6 defaults in `src/flags.ts`:

| Flag | Upstream default | Fork default |
|---|---|---|
| `enableDocumentStatus` | false | true |
| `enableNewLinkFormat` | false | true |
| `enableDocumentHistory` | false | true |
| `enableCanvasSync` | false | true |
| `enableVerifyUploads` | false | true |
| `enableDiscordLogin` | false | true |

## 2. `SyncSettings.otherTypes.defaultEnabled` — **UNLOCKED** (commit `4e1f063`)

`src/SyncSettings.ts:60` was `false`; the catch-all fallthrough silently dropped unknown extensions. Flipped to `true`.

## 3. Per-folder sync category paywall — **UNLOCKED** (commit `b134966`)

`src/components/ManageRemoteFolder.svelte:129` `noStorage` predicate was `quota === 0` with no metered check. Any self-host (quota always 0) saw a "Buy storage" CTA in place of the Images/Audio/Videos/PDFs toggles. Added `metered === false → false` short-circuit.

## 4. PB multi-relation invisible-relay — **UNLOCKED** (commit `fd0aa2d`)

`RelayManager.ts:_ingest` now runs `normalizePBRelations(record)` keyed by `PB_RELATION_FIELDS` schema map (shared_folders / relay_roles / shared_folder_roles / relay_invitations / subscriptions / storage_quotas / relays). Coerces `string[]` → first element in place for known multi-relation fields.

## 5. Enterprise-tenant license JWT — **UNLOCKED** (commit `a389ba5`)

`EndpointConfigModal` required every tenant URL to serve `/.well-known/relay.md/license`. Self-host has no such endpoint. Added "Self-hosted server (skip license check)" checkbox → `addTenant(url, false)` → skip `performTenantValidation`, set `apiUrl=authUrl=tenantUrl` directly.

## 6. createRelay scaffolding skip — **UNLOCKED** (commit `1164fa0`)

`RelayManager.createRelay()` used plain `pb.collection("relays").create()` bypassing `/api/collections/relays/self-host`. Result: relay with no `creator`, `provider`, `storage_quota`, `relay_roles`, or `relay_invitations` — the "orphan relay / no share key" symptom. Auto-routes through `createSelfHostedRelay(providerId)` when a `self_hosted=true` provider exists.

## 7. LoginManager unhandled 401 — **UNLOCKED** (commit `e00c34e`)

`refreshToken()` had `.then()` with no `.catch()`. Expired stored tokens surfaced as unhandled rejection on plugin onload. Now catches 401/403 → logout cleanly.

## 8. Observable subscriber null-race — **UNLOCKED** (commit `4e1f063`)

`Observable.notifyListeners` iterated `_listeners` with no null guard; `Postie.getFunctionOrigin` crashes on `null.name`. Added null skip.

---

## 9. **PolicyManager upload gate — BLOCKER**

`src/PolicyManager.ts:672`:
```ts
return storageQuota.usage + fileSize <= storageQuota.quota;
```

With self-host's `quota=0`, every attachment upload fails this policy silently. **Companion blocker to #3** — users can toggle "Images yes" in the UI but uploads still reject.

**Fix:** short-circuit when `storageQuota.metered === false`. Same predicate shape as #3.

## 10. **`isShareKeyEnabled` / `canManageSharing` — LATENT**

`ManageRelay.svelte:403-406`:
```ts
const canManageSharing = plugin.relayManager.userCan(
    ["relay", "manage_sharing"],
    relay,
);
```

`PolicyManager` grants `["relay", "manage_sharing"]` if user has an appropriate relay_role (Admin). Self-host users who created the relay DO get an Admin role via the scaffolding hook (#6). Verified — scaffolding creates `relay_role` granting `4fq4b8kntyvzn1l` role ID (Admin).

**No fix needed** as long as the creator scaffolding hook runs — which it now does.

## 11. **Subscription block in ManageRelay — COSMETIC**

`ManageRelay.svelte:811-858` guarded by `{#if $canManageSubscription}`. Self-host users with no subscription record never enter this block if `canManageSubscription` returns false. Needs to be confirmed.

Within the block:
- `{#if $subscription}` → Plan info + Cancel
- `{:else}` → "Plan: ${relay.plan}" + **Upgrade** button

`relay.plan` is a string field on relay records. For self-host-scaffolded relays it's empty string → display reads "Plan: ". Upgrade button opens `buildApiUrl('/subscribe/...')` → 404s on self-host PB.

**Fix:** gate the outer `{#if $canManageSubscription}` off when provider is self-hosted.

## 12. **Seat-count display — COSMETIC**

`ManageRelay.svelte:709`:
```
{$roles.values().length} of {$relay.userLimit} seats used
```

`relay.user_limit` is unset (0) on self-host scaffolded relays → shows "3 of 0 seats used". Cosmetic; no enforcement.

**Fix:** hide the "of N seats used" suffix when `relay.userLimit === 0`.

## 13. **External CTAs (`/subscribe`, `/upgrade`, `/subscriptions/...`) — COSMETIC**

All via `plugin.buildApiUrl(path)` which routes to the current `apiUrl` (self-host's PB URL). None of these routes exist in self-host PB — clicking produces 404 in a new browser window.

Call sites:
- `ManageRelay.svelte:252` `/subscribe/${encodedPayload}` (Upgrade button)
- `ManageRelay.svelte:259` `/subscriptions/${sub_id}/manage`
- `ManageRelay.svelte:268` `/subscriptions/${sub_id}/cancel`
- `ManageRemoteFolder.svelte:121` `/subscribe/${encodedPayload}?action="buy_storage"` (dead code after #3+#9 unlocks)
- `Relays.svelte:339` unknown action

**Fix:** hide the trigger UI when no self-hosted provider is absent or replace `buildApiUrl(/subscribe)` with a no-op / toast.

## 14. **`registerObsidianProtocolHandler("relay/upgrade")` — LATENT**

`main.ts:1108` — deep-link handler for `obsidian://relay/upgrade?version=X` triggers `installVersion(version)`. Not gating anything; handles a protocol URI dispatched from elsewhere. Likely driven by the in-plugin release notifier.

**No fix needed.**

---

## 15. **`leftRelayIds` tracking / post-update orphan sweep — DEFERRED**

Tracked as seeds `Relay-monorepo-b5c9`. Context from session e6b0ddd1 transcript:

> Track left relay IDs to prevent `_handleEvent` from re-ingesting relays after local cascade. Clear tracking on update() which does a full re-fetch. After update() loads all stores, cascade-delete shared folders whose relay no longer exists on the server.

Current `_handleEvent` (`RelayManager.ts:1765`):
```ts
if (e.action === "delete") this.store?.delete(e.record);
else this.store?.ingest(e.record);
```

No tracking of left relays → if user leaves a relay locally and then the PB subscription stream delivers a stale "update" event for that relay, it gets re-ingested. Manifests as ghost relays reappearing after you leave them.

**Trigger for fixing:** user reports a relay re-appearing after leaving. Not a current blocker.

---

## 16. **pb_hooks server-side gates — CLEAR**

`relay-control-plane/pb_hooks/misc.pb.js:111` `POST /api/subscription/:id/token` — returns a token string for subscription-level access. Only invoked when a subscription record exists and the plugin calls `getSubscriptionToken`. No gating on self-host where subscriptions are absent.

`relay_mgmt.pb.js` sets `provider.self_hosted: true` and scaffolds with `quota: 0, metered: false`. Matches what the client-side unlocks expect.

**No fix needed.**

---

## Priority

1. **#9 PolicyManager upload gate** — functional blocker; ship immediately
2. **#11 subscription-block Upgrade CTA visible to self-host users** — cosmetic but confusing
3. **#12 seat count "0 seats used"** — cosmetic
4. **#13 external CTAs to /subscribe, /subscriptions/...** — cosmetic dead links
5. **#15 leftRelayIds** — reactive; wait for recurrence
