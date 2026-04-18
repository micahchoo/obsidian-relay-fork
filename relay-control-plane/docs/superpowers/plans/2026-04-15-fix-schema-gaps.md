# Fix Control Plane Schema Gaps — Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the `relay-control-plane` PocketBase schema and rules into parity with the original Relay frontend contracts so that CRUD, expands, and custom endpoints work without 400s/403s.

**Architecture:** Add the missing fields and relations via a single PocketBase JS migration (migration 11), then update the custom `relay_mgmt.pb.js` hooks so that newly created records populate the new fields with sensible defaults. Finally verify that the local frontend (`Relay/src/RelayManager.ts`) can subscribe and expand without errors.

**Tech Stack:** PocketBase (Go/JS migrations), JavaScript hooks, SQLite backend, Obsidian Relay plugin (TypeScript).

---

## Flow Map

1. **Frontend** (`RelayManager.ts`) calls `.collection("relays").getList()` with `expand` including `subscriptions_via_relay.relay.storage_quota` and `creator`.
2. **Frontend** calls `.create()` on `shared_folders` sending `{name, private, relay, path, guid}`.
3. **Frontend** calls `.create()` on `relay_invitations` sending `{relay, key, enabled, role}`.
4. **Frontend** calls `.expand("shared_folder")` on `shared_folder_roles` — this requires the relation field to be named `shared_folder`.
5. **Frontend** calls `.update()` / `.delete()` on `relays`, `shared_folders`, `relay_roles`, `shared_folder_roles` as a normal authenticated user.
6. **Custom hook** `POST /api/collections/relays/self-host` creates a relay record and must now also set `version`, `user_limit`, `creator`, `cta`, `plan`, and create/link a default `storage_quota` record.

---

## Execution Waves

### Wave 1: Schema migration (blocking all other work)

### Task 1: Migration 11 — add missing fields, rename relation, fix rules

**Flow position:** Step 1 of 3 in schema fix (migration → hook updates → verification)
**Upstream contract:** N/A — this is the data-layer foundation.
**Downstream contract:** All collections must match the shapes expected by `RelayManager.ts` DAO interfaces.
**Skill:** `none`
**Files:**
- Create: `pb_migrations/11_fix_schema_gaps.js`

- [ ] **Step 1: Draft migration that drops and recreates collections with correct schema**

  Since this is greenfield with no real users, we will **drop and recreate** the affected collections rather than doing risky column renames.

  In `pb_migrations/11_fix_schema_gaps.js`:
  - Drop: `shared_folder_roles`, `shared_folders`, `relay_invitations`, `relays`, `storage_quotas`
  - Recreate ** `relays`** with:
    - `guid` (text, required)
    - `name` (text, required)
    - `path` (text, required)
    - `provider` (relation → `providers`, required)
    - `version` (text, not required, default `"1.0.0"`)
    - `user_limit` (number, not required, default `0`)
    - `creator` (relation → `users`, not required)
    - `cta` (text, not required)
    - `plan` (text, not required, default `"free"`)
    - `storage_quota` (relation → `storage_quotas`, not required, single)
    - `listRule`: `@request.auth.id != ""`, `viewRule`: `@request.auth.id != ""`, `createRule`: `@request.auth.id != ""`, `updateRule`: `@request.auth.id = creator`, `deleteRule`: `@request.auth.id = creator`
  - Recreate **`shared_folders`** with:
    - `relay` (relation → `relays`, required)
    - `creator` (relation → `users`, required)
    - `path` (text, required)
    - `guid` (text, required)
    - `name` (text, not required)
    - `private` (bool, not required, default `false`)
    - `listRule`: `@request.auth.id != ""`, `viewRule`: `@request.auth.id != ""`, `createRule`: `@request.auth.id != ""`, `updateRule`: `@request.auth.id = creator`, `deleteRule`: `@request.auth.id = creator`
  - Recreate **`relay_invitations`** with:
    - `relay` (relation → `relays`, required)
    - `key` (text, required)
    - `enabled` (bool, not required, default `true`)
    - `role` (relation → `roles`, not required)
    - `listRule`: `@request.auth.id != ""`, `viewRule`: `@request.auth.id != ""`, `createRule`: `@request.auth.id != ""`, `updateRule`: `@request.auth.id != ""`, `deleteRule`: `@request.auth.id != ""`
  - Recreate **`shared_folder_roles`** with:
    - `user` (relation → `users`, required)
    - `role` (relation → `roles`, required)
    - `shared_folder` (relation → `shared_folders`, required, cascadeDelete) — **note the rename from `folder`**
    - `listRule`: `@request.auth.id != ""`, `viewRule`: `@request.auth.id != ""`, `createRule`: `@request.auth.id != ""`, `updateRule`: `@request.auth.id != ""`, `deleteRule`: `@request.auth.id != ""`
  - Recreate **`storage_quotas`** with:
    - `relay` (relation → `relays`, required)
    - `quota` (number, not required, default `0`)
    - `usage` (number, not required, default `0`)
    - `metered` (bool, not required, default `false`)
    - `max_file_size` (number, not required, default `0`)
    - `listRule`: `@request.auth.id != ""`, `viewRule`: `@request.auth.id != ""`, `createRule`: `@request.auth.id != ""`, `updateRule`: `@request.auth.id != ""`, `deleteRule`: `@request.auth.id != ""`
  - Also update rules on **existing** collections that aren't being dropped:
    - `relay_roles`: `updateRule` → `@request.auth.id != ""`, `deleteRule` → `@request.auth.id != ""`
    - `providers`: `updateRule` → `@request.auth.id != ""`, `deleteRule` → `@request.auth.id != ""`
    - `subscriptions`: `updateRule` → `@request.auth.id != ""`, `deleteRule` → `@request.auth.id != ""`

  > **Note:** `@request.auth.id != ""` means "any authenticated user". This is intentionally permissive for the FOSS first pass; tighten later with member/owner checks.

- [ ] **Step 2: Run migration on a copy of the dev database**

  ```bash
  cp data/data.db data/data.db.bak
  go run github.com/pocketbase/pocketbase@latest migrate up
  ```
  Or if PocketBase is already built locally, run the binary with `migrate up`.

- [ ] **Step 3: Verify schema changes via SQLite inspection**

  ```bash
  sqlite3 data/data.db ".schema relays"
  sqlite3 data/data.db ".schema shared_folders"
  sqlite3 data/data.db ".schema relay_invitations"
  sqlite3 data/data.db ".schema shared_folder_roles"
  ```
  Expected: see new columns (`version`, `user_limit`, `creator`, `cta`, `plan`, `storage_quota`, `name`, `private`, `role`, `shared_folder`).

- [ ] **Step 4: Commit**

  ```bash
  git add pb_migrations/11_fix_schema_gaps.js
  git commit -m "feat: migration 11 — add missing fields, rename folder→shared_folder, fix rules"
  ```

---

### Wave 2: Hook updates (depends on Wave 1)

### Task 2: Update `relay_mgmt.pb.js` self-host endpoint to populate new relay fields

**Flow position:** Step 2 of 3 in schema fix
**Upstream contract:** Migration 11 must be applied.
**Downstream contract:** Frontend `RelayManager.ts` expects `relays` records to have `version`, `user_limit`, `creator`, `cta`, `plan`, `storage_quota` populated.
**Skill:** `none`
**Files:**
- Modify: `pb_hooks/relay_mgmt.pb.js`

- [ ] **Step 1: Locate the `POST /api/collections/relays/self-host` handler**

  Search for `routerAdd("POST", "/api/collections/relays/self-host"` in `pb_hooks/relay_mgmt.pb.js`.

- [ ] **Step 2: Insert default `storage_quota` creation before relay creation**

  Before the `relays` record is created, create a `storage_quotas` record with defaults:
  ```js
  const quotaRecord = new Record(storageQuotaCollection, {
    relay: "", // will be patched after relay creation if needed, or leave blank if PocketBase allows optional back-relations
    quota: 0,
    usage: 0,
    metered: false,
    max_file_size: 0,
  });
  $app.dao().saveRecord(quotaRecord);
  ```
  If the `storage_quotas` schema requires `relay` (it does in migration 1), you must create the relay first, then create the quota with `relay: relayRecord.id`, then update the relay with `storage_quota: quotaRecord.id`. Do this in two passes if necessary.

- [ ] **Step 3: Populate new relay fields on creation**

  When building the `relays` record, set:
  ```js
  version: "1.0.0",
  user_limit: 0,
  creator: authRecord.id,
  cta: "",
  plan: "free",
  // storage_quota set after quota record is created (see Step 2)
  ```

- [ ] **Step 4: Verify the endpoint still returns the relay record**

  The endpoint currently returns the relay record via `return c.JSON(200, record)`. Ensure this still happens after the two-pass save.

- [ ] **Step 5: Commit**

  ```bash
  git add pb_hooks/relay_mgmt.pb.js
  git commit -m "feat: populate new relay fields in self-host endpoint"
  ```

### Task 3: Update `relay_mgmt.pb.js` accept-invitation to handle `role` on relay_invitations

**Flow position:** Step 2 of 3 in schema fix
**Upstream contract:** Migration 11 applied.
**Downstream contract:** Frontend sends `{key}` only today, but the schema now supports `role`. For now, ensure the endpoint does not break if `role` is absent.
**Skill:** `none`
**Files:**
- Modify: `pb_hooks/relay_mgmt.pb.js`

- [ ] **Step 1: Locate `POST /api/accept-invitation`**

  Search for `routerAdd("POST", "/api/accept-invitation"`.

- [ ] **Step 2: Ensure invite lookup and role assignment tolerate missing `role` field**

  The endpoint creates a `relay_roles` record with a hardcoded Member role. Leave that logic alone. Just confirm that reading `relay_invitations` records does not crash because the new `role` column is nullable.

- [ ] **Step 3: (Optional) If the frontend starts sending `role` in accept-invitation, read it**

  For now, no code change needed unless the request body is parsed strictly. If the hook uses `c.requestInfo().body`, extra fields are ignored by PocketBase by default.

---

### Wave 3: Frontend contract verification (depends on Wave 1)

### Task 4: Audit `RelayManager.ts` for expand/CRUD compatibility

**Flow position:** Step 3 of 3 in schema fix
**Upstream contract:** Migration 11 applied.
**Downstream contract:** Frontend code must not contain hardcoded schema mismatches.
**Skill:** `none`
**Files:**
- Read: `/mnt/Ghar/2TA/DevStuff/Relay/src/RelayManager.ts`

- [ ] **Step 1: Verify `relays` expands**

  Search for `.collection("relays").subscribe` or `.getList` with `expand`. Confirm the expand array includes `subscriptions_via_relay.relay.storage_quota` and `creator`. After migration 11, this should succeed.

- [ ] **Step 2: Verify `shared_folder_roles` expand**

  Search for `.collection("shared_folder_roles")` with `.expand("shared_folder")`. Confirm it exists. After the rename from `folder` to `shared_folder`, this will now work.

- [ ] **Step 3: Verify `.create()` calls supply new fields**

  Search for `.collection("shared_folders").create(` and `.collection("relay_invitations").create(`. If the frontend already sends `name`, `private`, or `role`, note it. If not, create a follow-up seed to patch the frontend.

- [ ] **Step 4: Verify `.update()` / `.delete()` calls target collections with new rules**

  Search for `.update(` and `.delete(` on `relays`, `shared_folders`, `relay_roles`, `shared_folder_roles`. After migration 11, these should return 200/204 for authenticated users instead of 403.

---

### Wave 4: Integration test (depends on Waves 1–3)

### Task 5: Run control plane and test via frontend or curl

**Flow position:** Final verification
**Upstream contract:** Waves 1–3 complete.
**Downstream contract:** Control plane boots without migration errors and responds correctly to Relay plugin requests.
**Skill:** `none`
**Files:**
- N/A

- [ ] **Step 1: Build and start the control plane**

  ```bash
  docker compose up --build -d
  # or run the pocketbase binary directly
  ```

- [ ] **Step 2: Check migration success logs**

  Look for `Applied migration 11_fix_schema_gaps.js` in the PocketBase logs.

- [ ] **Step 3: Quick curl sanity check**

  ```bash
  curl -s http://127.0.0.1:8090/api/collections/relays/records?expand=subscriptions_via_relay.relay.storage_quota,creator | jq '.code'
  ```
  Expected: no `400` error; `code` key absent (success).

- [ ] **Step 4: Quick expand check for shared_folder_roles**

  ```bash
  curl -s "http://127.0.0.1:8090/api/collections/shared_folder_roles/records?expand=shared_folder" | jq '.code'
  ```
  Expected: success.

- [ ] **Step 5: (Optional) Run the Relay plugin build**

  In `/mnt/Ghar/2TA/DevStuff/Relay`:
  ```bash
  npm run build
  ```
  Expected: TypeScript compiles without new type errors related to schema shapes.

---

## Open Questions

### Wave 1
- **Task 1:** Does PocketBase's JS migration API automatically rename the underlying SQLite column when we change `field.name` on a relation field? (Assumption: no — we will use raw `ALTER TABLE` SQL as a safety net.)
- **Task 1:** Are there existing `shared_folder_roles` rows in `data.db` that would be orphaned by the rename? (Assumption: dev instance is small; if rows exist, `ALTER TABLE RENAME COLUMN` preserves them.)
- **Task 1:** Should `relays.storage_quota` be a single relation or required? (Assumption: optional single relation, because the original frontend DAO marks it as optional.)

### Wave 2
- **Task 2:** Does the `storage_quotas` schema still require `relay` to be non-null? (Migration 1 says `required: true` for `relay` in `storage_quotas`. Therefore we must create the relay record first, then the quota, then link the relay → quota.)
- **Task 2:** What default `max_file_size` should the quota have? (Assumption: `0` for unlimited / not enforced in FOSS first pass.)

### Wave 3
- **Task 4:** Does the frontend `RelayManager.ts` already send `name` and `private` when creating `shared_folders`? (Needs verification — if not, a frontend patch seed is required.)
- **Task 4:** Does the frontend rely on any other missing backend fields (e.g., `relays.version` used in UI filtering)? (Needs verification.)

---

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `pb_migrations/11_fix_schema_gaps.js` | create | `version` |
| `pb_hooks/relay_mgmt.pb.js` | patch | `storage_quota` |
| `pb_hooks/relay_mgmt.pb.js` | patch | `creator: authRecord.id` |
| `Relay/src/RelayManager.ts` | patch | `.expand("shared_folder")` |
<!-- PLAN_MANIFEST_END -->
