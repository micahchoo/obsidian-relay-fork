# PocketBase Flakiness Analysis

## Overview

This document identifies the most suspicious areas for flakiness in the relay-control-plane PocketBase setup.

## High Risk: Race Conditions in Startup

### 1. Entrypoint Timing Issues (`entrypoint.sh`)

**Problem**: The startup script has fragile timing assumptions:

```bash
/pb/pocketbase serve --http=0.0.0.0:8090 --dir=/pb/pb_data &
PB_PID=$!
```

The script immediately tries to talk to PocketBase without verifying it's actually ready:

```bash
if wget -q -O /dev/null http://127.0.0.1:8090/api/health 2>/dev/null; then
    break
```

**Flakiness sources:**
- No fixed delay before first health check — relies on immediate startup
- 30s timeout may not be enough on cold starts
- `|| true` silently swallows all errors — failures go unnoticed

### 2. Migration Execution Timing

**Problem**: Migrations run at container build time, but the database may be mounted from a previous volume:

```dockerfile
COPY pb_migrations /pb/pb_migrations
```

If migrations were already applied to the mounted volume, PocketBase may:
- Skip migrations (if already applied)
- Fail if schema changed between versions

**Flakiness sources:**
- No version checking on migrations
- No migration idempotency guarantees
- Volume state persistence across rebuilds

## Medium Risk: Dependency Ordering

### 3. `depends_on` Without Health Checks

```yaml
depends_on:
  - relay-server-sh
```

Only waits for container start, not readiness. If relay-server-sh takes time to bind its port, control-plane may fail to connect.

**Flakiness sources:**
- No `condition: service_healthy` on relay-server-sh
- No retry logic in relay plugin when server isn't ready

### 4. Volume Mount Ordering

```yaml
volumes:
  - ./data:/pb/pb_data
```

If `./data` doesn't exist, Docker creates it as root. PocketBase may fail to initialize properly.

**Flakiness sources:**
- Permissions issues on fresh volumes
- Empty directory vs pre-populated database mismatch

## Low Risk: Configuration

### 5. Environment Variable Interpolation

```bash
REDIRECT_URL="${PB_PUBLIC_URL:-http://127.0.0.1:8090}/api/oauth2-redirect"
```

If `PB_PUBLIC_URL` is set incorrectly, OAuth redirect URLs will be wrong, causing auth failures.

**Flakiness sources:**
- No validation of URL format
- Cached stale env values in containers

### 6. Shell Parsing Fragility

```bash
ADMIN_TOKEN=$(echo "$AUTH_RESPONSE" | sed 's/.*"token":"\([^"]*\)".*/\1/')
```

Using sed to parse JSON is fragile. Any JSON structure change breaks this.

**Flakiness sources:**
- No JSON parsing (jq would be safer)
- Silent failures with `|| true` everywhere

## Recommendations

| Priority | Issue | Fix |
|----------|-------|-----|
| 1 | Startup timing | Add `sleep 5` before first health check |
| 2 | Migration safety | Add version file check before applying |
| 3 | depends_on | Add `condition: service_healthy` |
| 4 | Shell JSON parsing | Install and use `jq` in container |
| 5 | Silent errors | Remove `|| true` from critical paths |
| 6 | Volume permissions | Create data dir with correct perms before run |