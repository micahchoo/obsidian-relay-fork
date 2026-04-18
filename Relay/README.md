# Relay — Self-Hosted Fork

A fork of [No-Instructions/Relay](https://github.com/No-Instructions/Relay) that unlocks the plugin's gating for self-hosted deployments. Works with the control plane in [obsidian-relay-fork/relay-control-plane](https://github.com/micahchoo/obsidian-relay-fork/tree/master/relay-control-plane).

Upstream Relay is source-available but leans on a managed PocketBase tenant for feature-flag overrides, storage metering, and enterprise license validation. Pointed at a self-hosted control plane it ships with most capabilities defaulted off because no tier override ever arrives. This fork flips the defaults and patches the corresponding UI/policy gates so self-host users get the whole plugin.

Companion monorepo: [obsidian-relay-fork](https://github.com/micahchoo/obsidian-relay-fork)
Audit of every gate: [LOCKS.md](../LOCKS.md)
Recovery context for the v0.7.5 rebase: [RECOVERY.md](../RECOVERY.md)

---

## Install

### Option A — BRAT (recommended for beta testers)

Add the fork as a beta plugin via the [Obsidian BRAT plugin](https://tfthacker.com/BRAT):

1. Install BRAT from *Settings → Community plugins*.
2. BRAT → *Add beta plugin*.
3. Paste: `micahchoo/obsidian-relay-fork`
4. Pick the most recent version (e.g. `v0.7.6-beta.1`).

BRAT reads `manifest-beta.json` from the tagged release, so you'll auto-update as new `-beta.N` tags ship.

### Option B — Manual install from a release

Every tagged release (`v*`) publishes a production build to [GitHub Releases](https://github.com/micahchoo/obsidian-relay-fork/releases). Download `main.js`, `manifest.json`, and `styles.css` (or `relay-<tag>.zip`), then copy into:

```
<your-vault>/.obsidian/plugins/system3-relay/
```

Enable **Relay** in *Settings → Community plugins*. The plugin id stays `system3-relay` so upstream and this fork can't coexist in the same vault — pick one per vault.

### Option C — Build from source

```bash
git clone https://github.com/micahchoo/obsidian-relay-fork.git
cd obsidian-relay-fork/Relay
npm install
npm run release   # production build -> main.js, styles.css
```

Copy the three artifacts into your vault as above.

Scripts:

| Script            | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run dev`     | esbuild watch (dev build, source maps)              |
| `npm run build`   | Typecheck + esbuild `develop` target                |
| `npm run release` | Typecheck + esbuild `production` target (minified)  |
| `npm run beta`    | esbuild `debug` target                              |
| `npm test`        | Jest                                                |
| `npm run lint`    | ESLint                                              |

---

## Point the plugin at your control plane

1. Start the control plane (see [relay-control-plane/README](../relay-control-plane/) or the monorepo README).
2. In Obsidian → *Settings → Relay* the login screen shows OAuth buttons (GitHub / Google / Microsoft). Below the buttons click **"Use a self-hosted server"**.
3. In the Enterprise Tenant modal:
   - Paste your control plane URL (e.g. `http://localhost:8090`).
   - Check **"Self-hosted server (skip license check)"**.
   - Click **Add Self-Hosted** → **Apply**.
4. The OAuth provider buttons will switch to the providers configured in your self-hosted PocketBase. Sign in.
5. Click **Create** to spin up a relay. Scaffolding (storage_quota, relay_role, share_invitation) is created server-side via `/api/collections/relays/self-host`.
6. Share folders to the new relay. Pass the share key visible in *Manage Relay → Share key* to collaborators; they enter it on their **Join** button in the same panel.

---

## What this fork changes vs upstream

Every patch is a minimal diff against upstream; see `LOCKS.md` for rationale and code anchors. Grouped by concern:

### Self-host flow additions

| Change | Where |
|---|---|
| "Use a self-hosted server" link on the login screen | `src/components/LoggedIn.svelte` |
| "Self-hosted server (skip license check)" checkbox on Enterprise Tenant modal — calls `addTenant(url, false)` so the tenant is accepted without a signed `/.well-known/relay.md/license` JWT | `src/components/EndpointConfigModalContent.svelte` |
| `EndpointManager.addTenant(validate=false)` now sets `authUrl = apiUrl = tenantUrl` so subsequent login works | `src/EndpointManager.ts` |
| `EndpointManager.validateAndSetEndpoints` short-circuits license validation when the active tenant is already marked `isValidated=false` with explicit endpoints | `src/EndpointManager.ts` |
| `RelayManager.createRelay` auto-routes through `createSelfHostedRelay(providerId)` when a `self_hosted=true` provider exists, ensuring server-side scaffolding runs | `src/RelayManager.ts` |

### Upstream feature-flag unlocks

Defaults flipped in `src/flags.ts` (upstream's `applyServerFlags` merges tier-keyed overrides from hosted PB; self-host PB sends nothing so local defaults stand):

```
enableDocumentStatus   false → true
enableNewLinkFormat    false → true
enableDocumentHistory  false → true
enableCanvasSync       false → true
enableVerifyUploads    false → true
enableDiscordLogin     false → true
```

### Storage-metering unlocks

| Change | Where |
|---|---|
| `SyncSettings.otherTypes.defaultEnabled` flipped to `true`; unknown file extensions now sync instead of being silently dropped | `src/SyncSettings.ts` |
| Per-folder sync toggles (Images / Audio / Videos / PDFs) no longer locked behind "Buy storage" CTA when `storageQuota.metered === false` | `src/components/ManageRemoteFolder.svelte` |
| `PolicyManager.hasStorageQuota` short-circuits to allow when unmetered — companion to the UI unlock so attachment uploads don't silently fail the `usage + size <= quota` check when `quota=0` | `src/PolicyManager.ts` |

### Data-model fix (invisible-relay / "invalid remote folder")

PocketBase multi-relation fields arrive as `string[]` while the DAO interfaces type them as `string`. Downstream `relays.get(array)` / `users.get(array)` returns undefined → caller either synthesises a stub record (invisible relay) or throws "invalid remote folder".

- `RelayManager._ingest` now runs `normalizePBRelations(record)` keyed by a `PB_RELATION_FIELDS` schema map covering `shared_folders`, `relay_roles`, `shared_folder_roles`, `relay_invitations`, `subscriptions`, `storage_quotas`, `relays`. Coerces `string[]` → first element in place before any collection sees it.

### UI-polish and resilience

| Change | Where |
|---|---|
| `LoginManager.refreshToken()` now catches 401/403 from `authRefresh` and triggers `logout()` instead of leaving an unhandled promise rejection on plugin onload | `src/LoginManager.ts` |
| `Observable.notifyListeners` filters null recipients (Postie crashed on `null.name` after unsubscribe/notify races) | `src/observable/Observable.ts` |
| `PluginSettings.handleCreateRelayEvent` exposes a `creatingRelay` flag → Relays.svelte button disables with "Creating..." during the async POST; prevents the duplicate-click orphan-relay storm (4 orphans in <2s observed) | `src/components/PluginSettings.svelte`, `src/components/Relays.svelte` |
| `ManageRelay.svelte` hides the Plan / Upgrade block when the relay is backed by a `self_hosted` provider | `src/components/ManageRelay.svelte` |
| Seat-count row reads `"N members"` instead of misleading `"N of 0 seats used"` when `relay.user_limit=0` | `src/components/ManageRelay.svelte` |
| Cleanup: `Relays.svelte` no longer receives the unused `providers` prop | `src/components/PluginSettings.svelte` |

---

## Self-host gotchas

These failure modes aren't plugin bugs per se but cost real time to diagnose. Full list in the [monorepo README](../README.md#self-host-gotchas); the two most common for plugin-side debugging:

1. **`pb_hooks/` bind mount goes stale.** Symptom: `docker exec <ctr> ls /pb/pb_hooks/` shows empty, even though the host directory has files and `docker inspect` shows the correct mount path. Recreate: `docker compose up -d --force-recreate control-plane`.
2. **Stored auth tokens from deleted server-side records** surface as an unhandled 401 on plugin reload. v0.7.6-beta.1 catches this and forces logout — but the user will see "Stored auth token rejected; logging out" in the console.

---

## Diagnostic checklist for OAuth 400s

If OAuth sign-in 400s:

1. **Final URL is `github.com/...`** → GitHub rejected `redirect_uri`. Edit your GitHub OAuth app's callback URL to exactly `http://<your-pb-host>:8090/api/oauth2-redirect`.
2. **Final URL is `localhost:8090/_/#/auth/oauth2-redirect-failure`** → PocketBase's built-in redirect handler is running instead of the custom hook. Check `docker exec <ctr> ls /pb/pb_hooks/`; empty = stale bind mount; recreate the container.
3. **200 but plugin never picks up the code** → the custom hook stores the code in the `code_exchange` collection; confirm the collection exists (it's seeded by `pb_migrations/`).

---

## Release process

Bump `manifest.json`, `manifest-beta.json`, and `versions.json` together, build a production bundle, pre-stage it, tag, push:

```bash
# bump these three to the new version (e.g. 0.7.6-beta.2)
#   Relay/manifest.json
#   Relay/manifest-beta.json
#   Relay/versions.json

cd Relay && npm run release
mkdir -p ../release-assets/vX.Y.Z[-beta.N]
cp main.js manifest.json styles.css ../release-assets/vX.Y.Z[-beta.N]/

cd ..
git add Relay/manifest*.json Relay/versions.json release-assets/vX.Y.Z[-beta.N]/
git commit -m "vX.Y.Z — <summary>"
git tag -a vX.Y.Z -m "vX.Y.Z — <summary>"
git push origin master vX.Y.Z
```

The release workflow at `.github/workflows/release.yml` picks up the pre-staged assets (preferred) or falls back to `npm run release` inside CI.

---

## Upstream sync

Pull upstream changes into `Relay/` periodically:

```bash
# one-time
git remote add relay-upstream https://github.com/No-Instructions/Relay.git

# every time
git fetch relay-upstream
git subtree pull --prefix=Relay relay-upstream main --squash
```

After each pull, re-apply the fork-unlocks if upstream touched the gated files. The LOCKS.md audit is kept current so each rebase is mechanical; `RECOVERY.md` explains the one-time context loss from the v0.7.5 submodule-flatten incident.

---

## License

- Upstream [No-Instructions/Relay](https://github.com/No-Instructions/Relay) — see `LICENSE` in this directory.
- Fork modifications — same license, no added warranty.
