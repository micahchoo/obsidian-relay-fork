# relay-control-plane — Deep Analytics

## Repository Overview

| Property | Value |
|----------|-------|
| **Name** | relay-control-plane |
| **Type** | Backend Service (PocketBase) |
| **Description** | Real-time collaboration backend for Relay |
| **Runtime** | PocketBase (Go-based SQLite) |
| **Deployment** | Docker |

## Source Statistics

| Metric | Value |
|--------|-------|
| **Files** | 24 |
| **Directories** | 8 |
| **Source Size** | ~75 KB |

## Architecture

### Technology Stack

- **Backend Framework**: PocketBase (Go + SQLite)
- **Database**: SQLite (data.db, logs.db)
- **Runtime**: Docker + Docker Compose
- **Language**: JavaScript (migrations, hooks)

### Directory Structure

```
relay-control-plane/
├── Dockerfile              # Container definition
├── docker-compose.yml      # Container orchestration
├── entrypoint.sh          # Startup script
├── relay.toml             # PocketBase config
├── .env                   # Environment variables
├── data/
│   ├── data.db            # Main database (221KB)
│   ├── logs.db            # Logs database (3.9MB)
│   ├── storage/           # Blob storage
│   └── types.d.ts         # TypeScript definitions
├── pb_migrations/         # Database migrations (13 files)
├── pb_hooks/              # PocketBase hooks (4 files)
├── docs/                  # Documentation
├── product/               # Product strategy
│   └── strategy/roadmap.md
└── relay-data/            # Data directory
```

### Database Schema (from migrations)

**Core Collections:**
- `users` — User accounts
- `relays` — Relay instances
- `shared_folders` — Folder sharing
- `storage_quotas` — Storage limits
- `invitations` — Invite codes
- `codes` — Auth codes

### Migrations (13 total)

| # | Name | Purpose |
|---|------|---------|
| 1 | init | Schema initialization (15KB) |
| 2 | fix_code_exchange_rules | Auth rule fix |
| 3 | fix_auth_rules | Auth rules |
| 4 | fix_relay_name_required | Validation |
| 5 | fix_users_login_rule | Login rules |
| 6 | fix_users_password_auth | Password auth |
| 7 | enable_email_auth | Email auth |
| 8 | allow_user_invitations | Invitation system |
| 9 | allow_user_relay_roles | Role management |
| 10 | fix_shared_folders | Folder schema fix |
| 11 | fix_schema_gaps (11KB) | Schema corrections |
| 12 | remove_used_from_storage_quotas | Schema cleanup |
| 13 | remove_used_by_id | Schema cleanup |

### Hooks (Server-side logic)

| File | Purpose |
|------|---------|
| `token.pb.js` | JWT token generation |
| `file_token.pb.js` | File access tokens |
| `relay_mgmt.pb.js` | Relay management |
| `misc.pb.js` | Miscellaneous |

## Configuration

### Environment Variables
- `.env` — Runtime configuration
- `.env.example` — Template

### Docker Configuration
- **Base Image**: PocketBase
- **Storage**: Docker volume for persistence
- **Ports**: Exposed via docker-compose

## Infrastructure

### Agent Tools
- `.claude/` — Claude Code config
- `.mulch/` — Expertise records
- `.seeds/` — Issue tracking

### Documentation
- `HANDOFF.md` — Development handoff
- `MIGRATION.md` — Migration guide
- `docs/` — Additional docs

## Key Files

### Largest Files
1. `1_init.js` (15KB) — Initial schema
2. `11_fix_schema_gaps.js` (11KB) — Schema fixes
3. `HANDOFF.md` (6.7KB) — Dev handoff
4. `MIGRATION.md` (8.3KB) — Migration guide

### Configuration
- `relay.toml` — PocketBase settings
- `docker-compose.yml` — Container setup
- `.env` — Environment

## Integration

### With Relay Plugin
- WebSocket server for CRDT sync
- REST API for relay management
- Authentication via PocketBase
- File storage via local storage

### Data Flow
1. User connects via Relay plugin
2. PocketBase authenticates
3. Yjs WebSocket provider connects
4. Real-time sync via Yjs

## Build & Deploy

### Local Development
```bash
docker-compose up
```

### Production
- Docker container deployment
- Volume mounts for data persistence