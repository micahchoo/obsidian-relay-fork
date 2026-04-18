# obsidian-relay-fork

A self-hosted fork of [Relay](https://github.com/No-Instructions/Relay), the CRDT-based multiplayer plugin for Obsidian, bundled with its control-plane backend so you can run the whole stack yourself.

This repo is a **flat monorepo** (both directories are in-tree, not submodules):

| Path                    | What it is                                                                            | Upstream                                      |
| ----------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| `Relay/`                | Obsidian plugin (TypeScript → esbuild).                                               | `No-Instructions/Relay` (pulled via subtree)  |
| `relay-control-plane/`  | PocketBase admin + JS hook + `relay-server` (y-sweet Yjs sync), via Docker.           | Internal                                      |

The plugin runs inside Obsidian and talks to the control plane; the control plane issues per-document tokens and proxies through `relay-server`.

---

## Clone

```bash
git clone https://github.com/micahchoo/obsidian-relay-fork.git
cd obsidian-relay-fork
```

No submodule dance — both `Relay/` and `relay-control-plane/` are regular directories.

---

## 1. `Relay/` — the Obsidian plugin

### Install a prebuilt release (recommended for users)

Every tagged release (`v*`) publishes a production build to [GitHub Releases](https://github.com/micahchoo/obsidian-relay-fork/releases). Download `main.js`, `manifest.json`, and `styles.css` (or the `relay-<tag>.zip` bundle), then copy them into:

```
<your-vault>/.obsidian/plugins/system3-relay/
```

Enable **Relay** in *Settings → Community plugins*.

### Build from source (for development)

```bash
cd Relay
npm install
npm run dev       # watch mode, rebuilds on save
# or
npm run release   # one-shot production build -> main.js, styles.css
```

Symlink the built output into your vault's `.obsidian/plugins/system3-relay/` directory for live testing.

Scripts exposed by `Relay/package.json`:

| Script            | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run dev`     | esbuild watch (dev build, source maps)              |
| `npm run build`   | Typecheck + esbuild `develop` target                |
| `npm run release` | Typecheck + esbuild `production` target (minified)  |
| `npm run beta`    | esbuild `debug` target                              |
| `npm run staging` | esbuild `staging` target                            |
| `npm test`        | Jest                                                |
| `npm run lint`    | ESLint                                              |

### Tagged releases

Pushing a tag matching `v*` triggers `.github/workflows/release.yml`, which:

1. Checks out the repo.
2. Runs `npm ci && npm run release` inside `Relay/`.
3. Attaches `main.js`, `manifest.json`, `styles.css`, and `relay-<tag>.zip` to a GitHub Release.

Obsidian's plugin submission requirements (`LICENSE`, `README.md`, `manifest.json` with `x.y.z` version, and the three artifact files attached to the release) are all satisfied by this setup.

```bash
# bump Relay/manifest.json and Relay/manifest-beta.json to the new version first
git commit -am "Bump plugin version to vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z — <summary>"
git push origin main
git push origin vX.Y.Z
```

---

## 2. `relay-control-plane/` — the self-hosted backend

Two services, both defined in `relay-control-plane/docker-compose.yml`:

| Service            | Port | Purpose                                                                     |
| ------------------ | ---- | --------------------------------------------------------------------------- |
| `relay-server-sh`  | 8082 | Yjs sync server (CRDT updates). Image: `docker.system3.md/relay-server`.    |
| `control-plane`    | 8090 | PocketBase — user accounts, relays, folders, token issuance. Built locally. |

### Run

```bash
cd relay-control-plane
cp .env.example .env       # if an example exists; otherwise create .env with required vars
docker compose up -d
docker compose logs -f
```

PocketBase admin UI: `http://localhost:8090/_/`
Relay-server health: `http://localhost:8082/health`

### Configure

- **`relay.toml`** — `relay-server` configuration. The `[server].url` field must match the address Obsidian clients use to reach the sync server (e.g. `http://<host-ip>:8082`).
- **`pb_hooks/`** — PocketBase JS hooks. Mounted read-only; edit in place and restart the container.
- **`pb_migrations/`** — PocketBase schema migrations, applied at startup.
- **`data/`** — PocketBase database (persistent volume).
- **`relay-data/`** — relay-server document store (persistent volume).

### Wire the plugin to this control plane

In Obsidian → *Settings → Relay* → set the control-plane URL to `http://<host-ip>:8090` and sign in. The plugin will fetch a self-hosted auth token and route sync traffic to the matching `relay-server`.

---

---

## Self-host gotchas (hard-won during initial setup)

These are non-obvious failure modes that cost a lot to diagnose. Keep them in mind when bringing up a fresh deployment.

1. **Client sends the relay's `guid`, not PocketBase's short `id`.** The token hook must use `findFirstRecordByFilter("relays", "guid = {:guid}", ...)` — not `findRecordById`. Getting this wrong returns 404 for every valid relay.
2. **`provider.url` is host-facing; `RELAY_SERVER_URL` env is container-facing.** The pb_hook prefers env when set, falls back to `providers.url` only if env is empty. Otherwise the hook tries to reach `http://localhost:8082` from inside the PB container and gets `ECONNREFUSED`.
3. **COSE `kid` in `RELAY_SERVER_AUTH` must be a byte-string (CBOR major type 2, `0x4b`-prefixed), not a text-string (`0x6b`).** y-sweet's CWT validator rejects text-string kid with `"Invalid token: The key ID did not match"`. The mint script in this README gets this right.
4. **`docker restart` does not reload `.env`.** After editing env vars, use `docker compose up -d --force-recreate control-plane`.
5. **`allowed_token_types` in `relay.toml`** must include `"server"` explicitly. Upstream default is `["document", "file"]` and silently rejects server-token auth at `/doc/:id/auth`.
6. **CWT audience validation** is enabled when relay.toml has `[server].url` set; the `aud` claim in `RELAY_SERVER_AUTH` must match that URL byte-for-byte.
7. **Legacy HMAC `[[auth]]` block is required.** `/doc/:id/auth` internally calls `gen_doc_token` → `sign()`, which requires an `AuthKeyMaterial::Legacy` key. Without it you get 500 `CannotSignWithPublicKey`.

---

## Repo conventions

- `Source/` — local working copies / vendor drops. Gitignored.
- `*HANDOFF*.md` — session-handoff docs. Gitignored.
- `docs/` — plans, specs, and architecture notes (tracked).
- `.mulch/`, `.seeds/` — project expertise and issue tracking (tracked).

## Upstream sync

To pull upstream plugin changes into `Relay/` (one-time remote setup, then one command):

```bash
# one-time
git remote add relay-upstream https://github.com/No-Instructions/Relay.git

# every time
git fetch relay-upstream
git subtree pull --prefix=Relay relay-upstream main --squash
```

## License

- `Relay/` — see `Relay/LICENSE` (upstream license).
- `relay-control-plane/` — provided as-is, no warranty.
