# FOSS Relay — Product Strategy & Roadmap

## Vision
A fully self-hostable, open-source replacement for the proprietary Relay backend. Anyone with network access to a relay (via Tailnet or reverse proxy) can authenticate via GitHub OAuth or ephemeral identities, create shared Obsidian folder relays, and let others join using a share code. The proprietary bits (license validation, paid subscriptions, proprietary hosting checks) are removed or made optional.

## Target Personas
1. **Self-Hoster** — Obsidian user who runs their own infra. Wants to sync vaults with friends or a small team without proprietary cloud lock-in.
2. **Privacy-First Team** — Small group on a Tailnet that needs a collaborative Obsidian vault. Needs zero external SaaS dependencies.
3. **Occasional Collaborator** — Someone invited to a shared folder. Wants to join quickly with a code, not manage accounts or licenses.

## Success Metrics (KPIs)
- **Time-to-first-share**: A new self-hoster can `docker compose up` and create a share in <10 minutes.
- **Join friction**: A collaborator can join a share with a code in <3 clicks and <30 seconds.
- **Frontend parity**: All plugin features that do not depend on proprietary billing/licensing work against the FOSS control plane.

## Roadmap

### Phase 1 — Foundation (P0)
**Fix control plane schema gaps to match frontend contracts**
- Add missing fields to `relays`, `shared_folders`, `relay_invitations`
- Fix `shared_folder_roles` relation naming
- Fix storage quota expand path
- Open update/delete rules for record owners

### Phase 2 — Decoupling (P1)
**Remove proprietary frontend checks**
- Bypass/remove license validation in `EndpointManager.ts`
- Remove or optionalize subscription/paid plan gating
- Make storage quotas soft or optional

**Auth simplification: GitHub OAuth + ephemeral identities**
- Keep PocketBase OAuth2 (GitHub) path
- Add ephemeral login path (display name + share code)
- Update `LoginManager.ts` and UI for FOSS auth modes

### Phase 3 — Experience (P2)
**Share-by-code join flow polish**
- End-to-end validation of accept-invitation and rotate-key
- Friendly error handling
- Human-friendly share codes (optional)

### Phase 4 — Distribution (P3)
**Documentation and self-host packaging**
- Docker Compose one-command setup
- Tailnet + reverse proxy guides
- Plugin configuration docs

## What's Out of Scope
- Commercial billing/subscription engine
- Proprietary hosting or tenant management
- Mobile app (Obsidian plugin only)
- Advanced RBAC beyond Owner/Member

## Strategic Brief for Build Pipeline
**Target persona**: Self-Hoster + Occasional Collaborator
**Success metric**: Time-to-first-share <10 min; Join friction <30 sec
**Priority rationale**: Without schema parity (Phase 1), nothing else works. Without removing proprietary checks (Phase 2), self-hosting is impossible. Phases 3+ polish the UX.
**Constraints**: No new proprietary SaaS dependencies. Must work entirely offline/on Tailnet.
