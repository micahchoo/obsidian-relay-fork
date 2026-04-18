# Migrating from relay.md to Self-Hosted

This guide covers moving from the commercial relay.md service to a fully self-hosted stack.
Your documents stay intact — CRDT data lives on your relay-server and does not need to be migrated.

**Two audiences:**
- [Server admin](#server-admin-setup) — runs the Docker containers, configures auth
- [Users](#user-setup) — rebuilds the plugin, logs in for the first time

---

## Architecture

```
Obsidian plugin
  → control-plane:8090  (PocketBase: auth + API hooks)
  → relay-server-sh:8082  (CRDT sync, bundled in the same compose stack)
```

The control plane and relay-server are both defined in `docker-compose.yml`. Standing up
the stack brings up both. Your existing relay-server (if any) is left untouched.

---

## What changes

| Component | Before | After |
|---|---|---|
| Auth / login | `auth.system3.md` | Your PocketBase (`control-plane:8090`) |
| API server | `api.system3.md` | Same PocketBase, custom hooks |
| Relay server | `docker.system3.md/relay-server` | `relay-server-sh` (bundled in compose) |
| Plugin | Points to system3.md | Points to your control plane |
| Document data | On your relay-server | Stays there — no migration needed |

---

## Server Admin Setup

### Prerequisites

- Docker + Docker Compose on the host
- A GitHub, Google, or Discord account (needed for OAuth login — see [Step 3](#step-3--configure-oauth-login))
- Port 8090 (control plane) and 8082 (relay server) free on the host

---

### Step 1 — Configure and start the stack

Copy the example env file and fill in the values:

```bash
cd relay-control-plane/
cp .env.example .env
```

The `.env.example` is pre-filled with working defaults for the bundled relay-server.
You only need to set the admin credentials:

```env
# These are pre-filled — only change if you need custom keys
RELAY_SERVER_URL=http://relay-server-sh:8080
RELAY_SERVER_AUTH=<server_token>
RELAY_PUBLIC_KEY=<public_key>
RELAY_KEY_ID=self_hosted
RELAY_KEY_TYPE=EdDSA

# Set a real password here
PB_ADMIN_EMAIL=admin@your-domain.com
PB_ADMIN_PASSWORD=<strong-password>
```

> If you want to generate fresh auth keys instead of using the pre-generated ones:
> ```bash
> # Start the relay-server-sh alone first, generate keys, then fill .env
> docker compose up -d relay-server-sh
> docker exec relay-control-plane-relay-server-sh-1 /app/relay gen-auth --json --key-type EdDSA
> # Copy "public_key" → RELAY_PUBLIC_KEY, "server_token" → RELAY_SERVER_AUTH
> # Update relay.toml [[auth]] public_key to match
> docker compose down
> ```

Check `relay.toml` and set the `url` to the address your Obsidian clients will use:

```toml
[server]
# If Obsidian runs on this machine:
url = "http://localhost:8082"
# If Obsidian runs on another machine on the network:
# url = "http://<this-machine-ip>:8082"
```

Build and start:

```bash
docker compose build
docker compose up -d
docker compose logs -f   # wait for "Server started at http://0.0.0.0:8090"
```

Verify all services are healthy:

```bash
# Control plane
docker exec relay-control-plane-control-plane-1 wget -qO- http://127.0.0.1:8090/flags
# → {}

docker exec relay-control-plane-control-plane-1 wget -qO- http://127.0.0.1:8090/api/health
# → {"code":200,...}

# Relay server reachable from control plane
docker exec relay-control-plane-control-plane-1 wget -qO- http://relay-server-sh:8080/ready
# → {"ok":true}
```

---

### Step 2 — Create the admin account

Open `http://localhost:8090/_/` in a browser.

On first run, PocketBase prompts you to create an admin (superuser) account. Use the
email and password from your `.env`.

If the page shows a login form instead of setup, log in with the same credentials.

---

### Step 3 — Configure OAuth login

The plugin **only** supports OAuth2 login. You must configure at least one provider before
any user can log in. All three options below are free.

#### Option A — GitHub (fastest setup)

1. Open [github.com/settings/applications/new](https://github.com/settings/applications/new)
2. Fill in:
   - **Homepage URL**: `http://localhost:8090`
   - **Authorization callback URL**: `http://localhost:8090/api/oauth2-redirect`
3. Register the app, then generate a **Client Secret**
4. In PocketBase admin at `http://localhost:8090/_/` → Settings → Auth providers → **GitHub**
   - Paste Client ID and Client Secret → Save

#### Option B — Google

1. [console.cloud.google.com](https://console.cloud.google.com/) → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web)
2. Add `http://localhost:8090/api/oauth2-redirect` as an authorized redirect URI
3. PocketBase admin → Settings → Auth providers → **Google** → paste credentials

#### Option C — Discord

1. [discord.com/developers/applications](https://discord.com/developers/applications) → New Application → OAuth2 tab
2. Add redirect: `http://localhost:8090/api/oauth2-redirect`
3. PocketBase admin → Settings → Auth providers → **Discord** → paste credentials

> Configure whichever provider your users already have accounts with. One is enough.

---

## User Setup

### Step 1 — Install the updated plugin

Get the `main.js` built against your control plane from your server admin, or build it:

```bash
cd /path/to/Relay
npm install
RELAY_API_URL=http://your-host:8090 RELAY_AUTH_URL=http://your-host:8090 node esbuild.config.mjs develop
```

Copy `main.js` into your vault:

```
<vault>/.obsidian/plugins/system3-relay/main.js
```

Reload Obsidian (Ctrl+Shift+R).

---

### Step 2 — Log in

1. Settings → Relay → click the login button
2. The configured OAuth provider(s) will appear
3. Complete OAuth in the browser that opens
4. Return to Obsidian as a logged-in user

---

### Step 3 — First relay setup

**Server admin (first user):**

1. Run command: **Relay: Register self-hosted Relay Server**
2. Enter the relay-server URL from `relay.toml [server] url`, e.g. `http://localhost:8082`
3. The control plane pings `/ready`, creates the relay, grants you admin role
4. Create a shared folder — an invitation key is generated automatically
5. Share the invitation key with other users

**Joining an existing relay:**

1. Settings → Relay → Accept Invitation → paste the key from your admin

---

## Document Data

Your CRDT data is stored by document ID on disk. When you set up a fresh relay and share
the same folders, the plugin re-connects to the same document IDs. Data already in your
vault syncs back up on reconnect.

The only things that don't transfer automatically are relay **metadata** (relay names,
membership lists) — those get recreated when you register the relay and invite users.

---

## Troubleshooting

**"No valid providers found" at login**

PocketBase has no OAuth providers configured. See [Step 3](#step-3--configure-oauth-login).

**`POST /api/token` returns 502**

Control plane can't reach the relay-server.
- Run `docker exec relay-control-plane-control-plane-1 wget -qO- http://relay-server-sh:8080/ready`
- If that fails: `docker compose ps` and `docker compose logs relay-server-sh`
- Check that `RELAY_SERVER_URL=http://relay-server-sh:8080` in `.env`

**Migration fails: "UNIQUE constraint failed: _collections.name"**

Leftover partial database from a failed first run. Safe to wipe on a fresh install:

```bash
docker compose stop
docker run --rm -v $(pwd)/data:/data alpine rm -f /data/data.db
docker compose up -d
```

**Relay-server rejects tokens (401 on WebSocket)**

`RELAY_PUBLIC_KEY` in `.env` doesn't match the `[[auth]]` `public_key` in `relay.toml`.
Both must be set to the same value. If in doubt, regenerate:

```bash
docker exec relay-control-plane-relay-server-sh-1 /app/relay gen-auth --json --key-type EdDSA
# Update relay.toml [[auth]] public_key and .env RELAY_PUBLIC_KEY + RELAY_SERVER_AUTH
docker compose down && docker compose up -d
```

**Documents don't sync**

Open Obsidian developer console (Ctrl+Shift+I) → look for `[TokenStore]` log lines.
The `ClientToken.url` field must be reachable from Obsidian's machine. Update
`relay.toml [server] url` to the correct address and restart: `docker compose restart relay-server-sh`.

**Login redirect fails**

The OAuth callback URL registered with the provider must exactly match
`http://your-host:8090/api/oauth2-redirect` (full path, no trailing slash).
