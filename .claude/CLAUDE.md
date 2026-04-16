## Scoped Rules

This project has `.claude/rules/` — file-scoped rules with YAML frontmatter
(`scope`, `tags`, `priority`, `source`) injected automatically when editing matching files.

**Using rules:**
- Rules matching your current file appear as context guidance. Follow them like CLAUDE.md instructions.
- When rules conflict, narrower scope wins. If genuinely ambiguous, ask.

**Growing rules — when you discover path-scoped knowledge:**
- Architectural contracts: "changes to this interface require updating consumers X, Y"
- Security boundaries: "this module handles PII — never log arguments"
- Migration state: "new code uses pattern B, don't extend pattern A"
- Coupling warnings: "these modules share state through X — change one, check the other"
- Known hazards: "last 3 bugs here were caused by X — always check Y"
- Data invariants: "field Z is always lowercase in DB — normalize before comparison"
- Performance constraints: "hot path — no allocations, no async"
- Stability tiers: "public API — never remove fields" vs "internal — change freely"
- Negative rules: "never import from X in Y — boundary is load-bearing"

Write a rule file: `scope` to the relevant paths, `source: hand-written`, `priority`
based on how strict it is. Scope to the narrowest directory containing all affected files.
Match the rule's domain, not an arbitrary directory.

**Pruning rules:**
- When a rule's scope no longer matches any files (directory renamed/deleted), delete it.
- When a `source: scaffold` rule is wrong for the project, fix it or delete it.
- When a machine-generated rule contradicts a hand-written one, the hand-written one wins.
  Delete the machine-generated one or narrow its scope.

**Never do:**
- Don't put rules in `~/.claude/` — rules are project-local, always.
- Don't create rules for things already enforced by linters/formatters — redundant.
- Don't create project-wide rules for file-specific concerns — scope them.
- Don't duplicate CLAUDE.md content into rules — rules express what CLAUDE.md can't.
