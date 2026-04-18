# Flakiness Fixes — Spike

## Priority 1: Entrypoint Timing (entrypoint.sh)

### Problem
Script tries to connect to PocketBase immediately after starting it, no fixed delay.

### Fix Required

```sh
# Add fixed delay before any health checks
sleep 5

# Then start health check loop
i=0
while [ $i -lt 30 ]; do
    if wget -q -O /dev/null http://127.0.0.1:8090/api/health 2>/dev/null; then
        break
    fi
    sleep 2  # Increased from 1s
    i=$((i+1))
done
```

**Changes needed:**
- Add `sleep 5` before loop
- Increase sleep interval from 1s to 2s
- Add logging of each retry attempt

---

## Priority 2: Shell JSON Parsing (entrypoint.sh)

### Problem
Using sed to parse JSON is fragile and breaks easily.

### Fix Required

```dockerfile
RUN apk add --no-cache ca-certificates wget jq
```

```sh
# Replace sed parsing with jq
AUTH_RESPONSE=$(wget -qO- --post-data "..." ...) || true
ADMIN_TOKEN=$(echo "$AUTH_RESPONSE" | jq -r '.token // empty')

if [ -z "$ADMIN_TOKEN" ]; then
    echo "Failed to get admin token"
    exit 1
fi
```

**Changes needed:**
- Add jq to Dockerfile
- Replace all sed parsing with jq
- Remove blanket `|| true` — fail explicitly on critical errors

---

## Priority 3: Migration Safety

### Problem
Migrations run at build time but database may be pre-existing volume.

### Fix Required

Add version tracking:

```sh
# In entrypoint.sh, before starting PocketBase
MIGRATION_VERSION=$(ls -1 /pb/pb_migrations/*.js 2>/dev/null | wc -l)
echo "$MIGRATION_VERSION" > /pb/pb_data/.migration_version

# On startup, check if migrations need running
# PocketBase already handles this — just add logging
```

Better: Add startup script that verifies migration count matches.

**Changes needed:**
- Add migration verification to entrypoint
- Log migration status on startup

---

## Priority 4: Docker Compose Health Checks

### Problem
`depends_on` only waits for container start, not readiness.

### Fix Required

```yaml
services:
  relay-server-sh:
    image: docker.system3.md/relay-server
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 3
    # ...

  control-plane:
    depends_on:
      relay-server-sh:
        condition: service_healthy  # ADD THIS
```

**Changes needed:**
- Add healthcheck to relay-server-sh service
- Change depends_on to use condition

---

## Priority 5: Volume Permissions

### Problem
Docker creates data directory as root, PocketBase may fail to write.

### Fix Required

```yaml
services:
  control-plane:
    volumes:
      - ./data:/pb/pb_data
    # Add user to avoid root ownership
    user: "1000:1000"  # Or use numeric UID from env
```

Or create directory before run:

```sh
# In entrypoint.sh or host
mkdir -p data
chmod 755 data
```

**Changes needed:**
- Add pre-create script or volume permissions config

---

## Priority 6: Error Handling

### Problem
`|| true` silently swallows all errors.

### Fix Required

```sh
# Replace blanket suppression with specific handling
set -e  # Exit on error for critical sections

# Disable for non-critical config only
set +e
wget ... || echo "OAuth config failed, continuing..."
set -e
```

**Changes needed:**
- Add `set -e` at script start
- Wrap non-critical sections with `set +e` / `set -e`
- Log failures explicitly

---

## Implementation Order

| Step | File | Change |
|------|------|--------|
| 1 | Dockerfile | Add jq |
| 2 | entrypoint.sh | Add sleep 5, use jq, improve error handling |
| 3 | docker-compose.yml | Add healthcheck, condition: service_healthy |
| 4 | host/entrypoint | Create data dir with perms |

---

## Testing Checklist

- [ ] Cold start (no existing volume) works
- [ ] Warm start (existing volume) works
- [ ] Migration re-run on old volume works
- [ ] OAuth config applies correctly
- [ ] Health checks properly detect failures
- [ ] Logs show clear startup sequence