---
name: librarian
description: >-
  Manage the project .claude/ directory — organize, audit, split, migrate, catalog,
  archive, prune, index, and persist reference docs. Triggers on: "librarian",
  "organize claude", "audit .claude", "split CLAUDE.md", "catalog", "archive context",
  "persist this", "save reference", "index the docs", "clean up .claude".
  Also triggers automatically at session start in any project with a .claude/ dir
  (deploy-librarian.sh copies this skill there).

  Do NOT use for: ~/.claude/ personal config management, git operations, or
  project code organization outside .claude/.
---

# Librarian

Manage this project's `.claude/` directory. Mandate: maximize what lives in **project `.claude/`** (committed, team-shared), minimize what leaks into **`~/.claude/`** (personal only). Test: "Would a new teammate benefit?" → project `.claude/`. Otherwise → personal.

---

## Auto-Deploy

This skill self-installs into any project with a `.claude/` directory via `deploy-librarian.sh` (wired to SessionStart). To bootstrap manually:

```bash
mkdir -p .claude/skills/librarian
cp ~/.claude/skills/librarian/SKILL.md .claude/skills/librarian/SKILL.md
git add .claude/skills/librarian/SKILL.md
```

To update the project copy from your user-level version:
```bash
bash ~/.claude/scripts/deploy-librarian.sh --force
```

---

## Duties

### 1. Catalog & Index

Maintain `.claude/INDEX.md` — manifest of every file in `.claude/`, its purpose, and last-updated date.

```bash
find .claude/ -type f | sort
```

Reconcile against INDEX.md. Flag:
- **Orphaned** — file exists, not referenced anywhere
- **Stale** — not updated in 30+ days (check `git log --since=30.days .claude/`)
- **Duplicate** — same content in two places

### 2. Audit & Diagnose

- CLAUDE.md line count: if >80 lines, recommend split into `rules/`
- Check `~/.claude/` for project-specific content hiding at user level — offer migration
- Verify `.claude/.gitignore` covers `settings.local.json` and optionally `agent-memory/`
- Rules missing `paths:` frontmatter that mention specific directories → path-gate them
- Repeated content across skills/rules → extract to `docs/`

### 3. Split CLAUDE.md

When CLAUDE.md is bloated, decompose:

| Content type | Destination |
|---|---|
| Code style/naming | `rules/code-style.md` |
| Architecture/layers | `rules/architecture.md` |
| Test conventions | `rules/testing.md` |
| Path-specific guidance | `rules/<topic>.md` with `paths:` frontmatter |
| Build/test/lint commands | Keep in root CLAUDE.md (<40 lines after split) |

### 4. Migrate Personal → Project

Move project knowledge from `~/.claude/` → `.claude/`:
1. Copy to project equivalent
2. Verify via `/memory` or `/skills`
3. Delete original only with explicit user approval

### 5. Prune & Archive

- Remove rules/skills not invoked in project history: `git log --oneline -- .claude/` per file
- Before deleting: move to `.claude/archive/` with datestamp prefix (`2026-04-09_old-rule.md`)
- Prune `docs/` entries that no skill references

### 6. Persist Reference Docs

When context contains something worth keeping beyond this session — a decision, API gotcha, architecture conclusion, research finding — write a timestamped snapshot:

```
.claude/docs/ref-YYYY-MM-DD-<slug>.md
```

Format:
```markdown
---
created: 2026-04-09
source: conversation / web search / file analysis
tags: [api-design, migration]
---
# <Descriptive Title>

<Compressed, actionable content. No filler. Bullet points fine.>
```

Rules:
- Max 60 lines per doc. Split by topic if longer.
- Compress aggressively — strip examples unless they're the point, remove hedging
- Add to INDEX.md immediately after writing
- Tags must be grep-able: skills use `@.claude/docs/ref-YYYY-MM-DD-slug.md` to reference

**Proactive triggers** (don't wait to be asked):
- User states a design decision or constraint verbally
- Research yields critical API behavior or non-obvious gotcha
- Debugging session reveals root cause that isn't obvious from the code
- Architecture discussion produces conclusions → persist them

### 7. Path-Gate Rules

Any rule mentioning specific directories needs `paths` frontmatter:

```yaml
---
paths: src/frontend/**
---
```

Prevents wasting context tokens when Claude works elsewhere in the codebase.

### 8. Cross-Reference

- Check existing `docs/` before embedding content in a new rule/skill — `@`-include instead of duplicating
- One source of truth per topic

---

## Target Structure

```
project/
├── CLAUDE.md                    # <40 lines: identity, stack, commands only
├── .mcp.json                    # Team MCP servers
├── .claude/
│   ├── INDEX.md                 # Manifest of everything below
│   ├── settings.json            # Permissions, hooks, env vars
│   ├── settings.local.json      # Personal overrides (gitignored)
│   ├── .gitignore
│   ├── rules/                   # Auto-loaded, path-gatable
│   ├── commands/                # /project:name slash commands
│   ├── skills/                  # Multi-file workflows (this file lives here)
│   ├── agents/                  # Subagent definitions
│   ├── docs/                    # On-demand reference (not auto-loaded)
│   │   └── ref-YYYY-MM-DD-*.md  # Timestamped context snapshots
│   ├── output-styles/           # Custom formatting
│   └── archive/                 # Datestamped retired files
```

## What Stays in ~/.claude/

Only: personal tone prefs, cross-project shortcuts, personal MCP servers, personal permission overrides. Nothing project-specific.

---

## Diffusion Triggers

| Upstream skill | When to route here |
|---|---|
| `hybrid-research` | After synthesis — persist key findings as reference docs |
| `brainstorming` | After design doc written — catalog it in INDEX.md |
| `handoff` | Before writing HANDOFF.md — persist context that outlasts sessions |
| `executing-plans` | After plan completion — archive the plan, update INDEX.md |
| `codebase-diagnostics` | After analysis — persist architecture findings as ref docs |
