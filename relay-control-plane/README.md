# relay-control-plane

The self-hosted backend for the [Relay plugin fork](../Relay/README-FORK.md). Two services in a single `docker-compose.yml`, swappable for upstream Relay's managed `auth.system3.md` plane.

> You do not need this directory if you use upstream's managed plane — you pay them for it. You need this directory when you want to run the whole collab stack on your own infrastructure.

---

## Role of each service vs upstream

Upstream Relay has one conceptual backend (`auth.system3.md` + `relay-server` hosted behind it) that does identity, scaffolding, metering, tier-gating, and Yjs sync. This fork splits the same responsibilities into two local containers plus a PocketBase-hosted JS rules layer:

| Responsibility | Upstream (hosted) | This control plane |
|---|---|---|
| **User accounts, OAuth, session tokens** | `auth.system3.md` (managed PocketBase) | `control-plane` container — PocketBase 0.22.20 with GitHub/Google/Discord/Microsoft OAuth providers configured via `pb_hooks` on startup |
| **Relay / shared-folder / role records** | Server-issued and metered | PocketBase collections under your admin, no metering |
| **Issuing per-document sync tokens** | Internal `/token` endpoint on `auth.system3.md` | `pb_hooks/token.pb.js` custom route at `/token` — mints short-lived CWT for `relay-server` to validate |
| **OAuth2 redirect relay** | `/api/oauth2-redirect` served by managed PB | `pb_hooks/misc.pb.js` custom route at the same path — stores the code in a `code_exchange` collection, plugin polls for it |
| **Self-host relay creation (scaffolding)** | Not applicable | `pb_hooks/relay_mgmt.pb.js` at `/api/collections/relays/self-host` — creates `storage_quota`, `relay_role`, `relay_invitation` atomically when the plugin POSTs to create |
| **File-upload tokens** | Hosted, metered | `pb_hooks/file_token.pb.js` issues file tokens for attachments |
| **Feature-flag overrides per subscription tier** | Server-pushed overrides via `applyServerFlags` | Nothing — self-host PB sends no overrides; the fork flips local defaults in `Relay/src/flags.ts` instead (see [LOCKS.md](../LOCKS.md)) |
| **Enterprise tenant license verification** | Signed JWT at `/.well-known/relay.md/license` | Skipped — the plugin's "Self-hosted server (skip license check)" checkbox bypasses it |
| **Yjs CRDT sync protocol** | Managed `relay-server` behind auth | `relay-server-sh` container (`docker.system3.md/relay-server` image) — y-sweet Yjs sync server with persistent document store on a mounted volume |
| **Subscription / billing / Stripe** | Hosted | Not implemented — there is no paywall in the fork |
| **Storage metering** | Hosted-enforced quotas | `storage_quotas.metered = false`, `quota = 0`; the fork's `PolicyManager` treats unmetered as unlimited (see [LOCKS.md #9](../LOCKS.md)) |

In short: **PocketBase is the identity + relational store + scaffolding hook-runner**, and **`relay-server` is the real-time CRDT transport**. PocketBase mints a token, `relay-server` validates it, then `relay-server` handles WebSocket traffic for the Yjs document.

---

## Architecture

```
┌──────────────────────┐    HTTP/8090          ┌───────────────────────┐
│                      │  (PB API + hooks)     │   control-plane       │
│  Obsidian plugin     │──────────────────────▶│   (PocketBase 0.22)   │
│  (system3-relay)     │                       │   /pb_hooks/*.pb.js   │
│                      │                       │   ↓ mint CWT          │
└──────────────────────┘                       └─────────┬─────────────┘
             │                                           │
             │ WebSocket /d/<docId>/ws                   │ HTTP /doc/:id/auth
             │  (carries CWT)                            │  (server→server)
             ▼                                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  relay-server-sh  (y-sweet Yjs sync, port 8082)                     │
│  validates CWT → opens WS → persists doc to /app/data volume        │
└─────────────────────────────────────────────────────────────────────┘
```

Flow for a client opening a shared folder:

1. Plugin POSTs `{docId, relay, folder}` to `http://<cp-host>:8090/token` with its PocketBase user auth.
2. `pb_hooks/token.pb.js` looks up the relay by guid, calls `relay-server-sh` at `/doc/<id>/auth` to obtain a doc-scoped CWT, returns `{token, url}` to the plugin.
3. Plugin opens a WebSocket to `ws://<cp-host>:8082/d/<docId>/ws` carrying the CWT.
4. `relay-server` validates the CWT (public-key + audience) and brokers Yjs updates.

---

## Quickstart

```bash
cd relay-control-plane
cp .env.example .env       # fill in the env vars below
docker compose up -d
docker compose logs -f     # watch startup; should say "Startup complete"
```

- PocketBase admin UI: <http://localhost:8090/_/>
- Relay-server health: <http://localhost:8082/health>

To verify the hook layer:

```bash
curl -sv 'http://localhost:8090/api/oauth2-redirect?code=TEST&state=TEST'
# Expect: HTTP/1.1 200 OK + "Authentication complete" HTML
# If you get: 307 Temporary Redirect to /_/#/auth/oauth2-redirect-failure
#   -> the pb_hooks bind mount went stale; force-recreate (see Gotchas)
```

---

## `.env` reference

From `.env.example` — all required unless marked:

| Var | Purpose |
|---|---|
| `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` | Seeded on first boot by `entrypoint.sh` via PB's superuser API. |
| `PB_PUBLIC_URL` | Host-facing URL that clients dial (e.g. `http://localhost:8090`). |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | OAuth app; callback URL **must** be `${PB_PUBLIC_URL}/api/oauth2-redirect`. |
| `RELAY_SERVER_URL` | Container-internal relay-server URL (`http://relay-server-sh:8080`). Preferred over `providers.url` when set — see Gotcha #2. |
| `RELAY_SERVER_AUTH` | CWT token that `control-plane` uses to call `relay-server`'s `/doc/:id/auth` endpoint. |
| `RELAY_PUBLIC_KEY`, `RELAY_KEY_TYPE`, `RELAY_KEY_ID` | Public key seeded into newly-created `providers` records via the self-host scaffolding hook. |

Regenerate `RELAY_SERVER_AUTH` + matching `[[auth]].public_key` in `relay.toml`:

```bash
docker exec relay-control-plane-relay-server-sh-1 /app/relay gen-auth --json --key-type EdDSA
```

Copy the `auth_token` into `.env` as `RELAY_SERVER_AUTH`, copy the `public_key` into both `.env` (as `RELAY_PUBLIC_KEY`) and `relay.toml`'s `[[auth]]` block, then:

```bash
docker compose up -d --force-recreate control-plane
```

A standalone mint helper is also available at `scripts/mint-server-auth.py` if you need to regenerate only the server token.

---

## Directory layout

```
relay-control-plane/
├── docker-compose.yml      # two services: relay-server-sh (8082) + control-plane (8090)
├── Dockerfile              # builds control-plane from alpine + PB 0.22.20
├── entrypoint.sh           # starts PB, seeds admin, configures OAuth providers, waits on PID
├── .env / .env.example     # environment (gitignored)
├── relay.toml              # relay-server config (server.url, auth public keys, allowed_token_types)
├── pb_hooks/               # mounted into container at /pb/pb_hooks
│   ├── token.pb.js         # POST /token — mint per-document CWT
│   ├── file_token.pb.js    # file-upload tokens for attachments
│   ├── misc.pb.js          # /api/oauth2-redirect (custom), /api/subscription/:id/token
│   └── relay_mgmt.pb.js    # POST /api/collections/relays/self-host, /api/accept-invitation, /api/rotate-key
├── pb_migrations/          # 13 JS migrations, applied in numeric order at startup
├── data/                   # PB database (persistent volume, gitignored)
├── relay-data/             # relay-server document store (persistent volume, gitignored)
└── scripts/
    └── mint-server-auth.py # standalone helper to regenerate RELAY_SERVER_AUTH
```

---

## Configuring OAuth for self-host

The `entrypoint.sh` script hits PB's settings API on startup and installs the OAuth providers whose env vars are set. For GitHub:

1. Create an OAuth app at <https://github.com/settings/developers>.
2. **Authorization callback URL:** `${PB_PUBLIC_URL}/api/oauth2-redirect` exactly — no trailing slash, `http://` for localhost (GitHub allows this).
3. Put the client id + secret in `.env` as `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
4. `docker compose up -d --force-recreate control-plane`.

The same shape applies to Google / Discord / Microsoft — set the corresponding env vars, redirect URL always the same path on your PB URL.

> Upstream Relay's OAuth apps are registered against `auth.system3.md`. Self-host users must register their own OAuth apps against their own PB URL.

---

## Self-host gotchas

Running list of non-obvious failure modes caught during fork development. These live in the monorepo README too; mirrored here for convenience.

1. **Client sends the relay's `guid`, not PB's short `id`.** `pb_hooks/token.pb.js` uses `findFirstRecordByFilter("relays", "guid = {:guid}", ...)`. Changing it to `findRecordById` returns 404 for every valid relay.

2. **`RELAY_SERVER_URL` env is container-facing; `providers.url` is host-facing.** The token hook prefers env when set. Without that priority order, the hook tries `http://localhost:8082` from *inside* the PB container → `ECONNREFUSED`.

3. **COSE `kid` in `RELAY_SERVER_AUTH` must be CBOR major type 2 (byte-string, `0x4b`-prefixed)**, not major type 3 (text-string, `0x6b`). y-sweet's validator rejects text-string kid with `"Invalid token: The key ID did not match"`. `scripts/mint-server-auth.py` encodes it correctly.

4. **`docker restart` does NOT reload `.env`.** Use `docker compose up -d --force-recreate control-plane`.

5. **`allowed_token_types` in `relay.toml` must include `"server"`.** Upstream default is `["document", "file"]` and silently rejects server-token auth at `/doc/:id/auth`.

6. **CWT audience validation** is enabled when `relay.toml` has `[server].url` set; the `aud` claim in `RELAY_SERVER_AUTH` must match that URL byte-for-byte.

7. **The legacy HMAC `[[auth]]` block is required.** `/doc/:id/auth` internally calls `gen_doc_token → sign()` which needs an `AuthKeyMaterial::Legacy` key. Without it you get 500 `CannotSignWithPublicKey`.

8. **`pb_hooks/` bind mount goes stale when the host directory is recreated.** Symptom: `docker exec <ctr> ls /pb/pb_hooks/` is empty even though the host directory has the files and `docker inspect` shows the correct mount path. Cause: Docker bind mounts follow inodes, and git operations (e.g. submodule deinit + reclone) can replace the directory under the mount. Fix: `docker compose up -d --force-recreate control-plane`. Symptom propagation: `/api/oauth2-redirect` returns 307 to PB's built-in failure route instead of 200 from the custom hook, and the plugin can never complete OAuth.

9. **The scaffolding hook's expand chain only returns relay_roles and relay_invitations — not the user record.** When the plugin receives the create response, the relay_role refers to a user that isn't in the local `users` ObservableMap yet. `RelayRoleAuto.user` returns a `[unknown user]` placeholder stub rather than throwing; the warn in the console is harmless.

10. **Scaffolded self-hosted relays ship with `storage_quota.metered = false, quota = 0`.** The fork's `PolicyManager` and `ManageRemoteFolder` UI both short-circuit on `metered === false` to treat this as "unlimited". Don't set `metered = true` without also setting `quota` to a nonzero byte count, or uploads will start failing policy checks.

---

## Operational runbook

### Force-recreate after env / hook edits

```bash
docker compose up -d --force-recreate control-plane
```

### Superuser auth for CLI cleanup

```bash
EMAIL=$(grep '^PB_ADMIN_EMAIL=' .env | cut -d= -f2)
PW=$(grep '^PB_ADMIN_PASSWORD=' .env | cut -d= -f2)
TOKEN=$(curl -s -X POST http://localhost:8090/api/admins/auth-with-password \
  -H 'Content-Type: application/json' \
  -d "{\"identity\":\"$EMAIL\",\"password\":\"$PW\"}" | jq -r .token)
```

Use in `-H "Authorization: $TOKEN"` (no `Bearer` prefix — PB convention).

### Sweep orphans

Relays whose scaffolding failed (missing creator/provider/storage_quota) can pile up from pre-fork-fix plain `collection.create()` calls, or from duplicate-click storms before the `creatingRelay` button guard landed. To clean:

```bash
curl -s -H "Authorization: $TOKEN" \
  "http://localhost:8090/api/collections/relays/records?perPage=200" \
| jq -r '.items[] | select(.creator == [] or .provider == []) | .id' \
| while read id; do
    curl -s -X DELETE -H "Authorization: $TOKEN" \
      "http://localhost:8090/api/collections/relays/records/$id"
  done
```

`shared_folders` don't cascade-delete from `relays` — sweep them next:

```bash
# find shared_folders whose relay no longer exists, then DELETE each
```

`storage_quotas` similarly don't cascade — sweep by filter `relay = []` after deleting orphan relays.

### Watch hook activity

```bash
docker compose logs -f control-plane | grep -E '\[/token\]|\[oauth2-redirect\]|\[self-host\]'
```

### Rotate the server key

1. Regenerate via `scripts/mint-server-auth.py` or `docker exec ... /app/relay gen-auth`.
2. Update `.env` (`RELAY_SERVER_AUTH`, `RELAY_PUBLIC_KEY`).
3. Update `relay.toml` `[[auth]]` block (public key in PEM form).
4. `docker compose up -d --force-recreate` (both services — `relay-server-sh` reads `relay.toml`, `control-plane` reads `.env`).

---

## License

`relay-server` image pulled from `docker.system3.md/relay-server` — see upstream terms.
Everything else in this directory — provided as-is, no warranty.
