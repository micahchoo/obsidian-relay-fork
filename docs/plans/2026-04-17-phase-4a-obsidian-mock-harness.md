# Phase 4a — Obsidian Mock Harness Plan

**Status:** Ready to execute
**Scope:** Test infrastructure only — no production code changes
**Blocks:** Phase 4b (characterization tests), downstream 4c/4d codemods
**Author:** Session 2026-04-17

## Goal

Build enough Obsidian API surface mocks in `Relay/__tests__/mocks/obsidian.ts` to unblock characterization tests on the five highest-priority subsystems. The harness must satisfy ts-jest's ESM preset, support Svelte component tests (where mocks are imported transitively), and be extensible without forcing downstream test rewrites.

## Non-goals

- Mocking every Obsidian symbol used anywhere in the codebase (YAGNI — we mock what the 5 target files actually need)
- Fidelity to Obsidian's internal behavior beyond what tests assert
- Integration-level behavior (real IndexedDB, real CodeMirror state, real Yjs traffic) — those belong in Phase 4b test-by-test setup, not in the shared mock
- Replacing the Obsidian runtime for smoke testing — that's what real Obsidian is for

## Current state

- `jest.config.js`: `ts-jest/presets/default-esm`, `moduleNameMapper` already rewrites `src/*` and `.js` suffixes, `testPathIgnorePatterns: ["/__tests__/mocks/"]`
- `__tests__/` has one real test (`ObservableMap.test.ts`) + `mocks/MockTimeProvider.ts` + Test* fixtures — no obsidian mock yet
- 40+ source files import from `"obsidian"`. Target files for Phase 4b:
  - `SharedFolder.ts` — 29 anti-patterns
  - `RelayManager.ts` — 20
  - `LiveViews.ts` — 19
  - `main.ts` — 16
  - `SyncFile.ts` — 15

## Strategy

**Single mock module** at `__tests__/mocks/obsidian.ts` wired via `jest.config.js` `moduleNameMapper`: `"^obsidian$": "<rootDir>/__tests__/mocks/obsidian.ts"`. This is the canonical pattern for Obsidian plugin testing and matches the existing `mocks/` convention (which is already in `testPathIgnorePatterns`, so the mock file itself isn't run as a test).

**Rationale for single file over per-symbol files:**
- One source of truth; cross-mock dependencies (Modal extends from an internal base, TFile references TFolder) resolve naturally
- Jest hoisting complications avoided — `moduleNameMapper` is resolved before module evaluation
- Easy to grep for a symbol's mock implementation
- Tests can override individual exports via `jest.mock("obsidian", ...)` when they need custom behavior

**Rationale for real module path, not `__mocks__/` auto-mock:** ts-jest's ESM preset has fragile interaction with jest's `__mocks__` auto-discovery. Explicit `moduleNameMapper` is deterministic and already proven to work in this config.

## API surface needed (derived from imports in 5 target files)

### Classes (need class constructors + `extends`-compatible shapes)

- `App` — container for vault, workspace, metadataCache; passed as constructor arg to most Obsidian objects
- `Plugin` — base class for `main.ts`; needs `loadData`, `saveData`, `registerEvent`, `registerDomEvent`, `registerInterval`, `addCommand`, `addRibbonIcon`, `addStatusBarItem`, `addSettingTab`, `app`, `manifest`
- `PluginSettingTab` — base for `SettingsTab.ts`; needs `app`, `plugin`, `containerEl`, `display`, `hide`
- `Modal` — base for `FolderCreateModal`, `DebugModal`, etc.; needs `app`, `contentEl`, `titleEl`, `open`, `close`, `onOpen`, `onClose`
- `TFile` — `path`, `name`, `extension`, `basename`, `parent`, `stat`, `vault`
- `TFolder` — `path`, `name`, `parent`, `children`, `vault`, `isRoot`
- `Vault` — `getFiles`, `getFolderByPath`, `getFileByPath`, `getAbstractFileByPath`, `read`, `cachedRead`, `modify`, `create`, `createFolder`, `delete`, `rename`, `adapter`, `on`, `off`; **must** be `EventTarget`-like for `SharedFolder` tests
- `TextFileView` — base for `CanvasView`; needs `file`, `data`, `contentEl`, `leaf`, `app`, `setViewData`, `getViewData`, `clear`
- `MarkdownView` — used by LiveViews; needs `editor`, `file`, `previewMode`, `currentMode`
- `WorkspaceLeaf` — used by LiveViews/CanvasView; needs `view`, `getViewState`, `setViewState`, `detach`, `app`, `openFile`
- `Notice` — constructor takes message/timeout; needs `setMessage`, `hide`. Tests frequently assert Notice was thrown; expose a `Notice.instances` array or jest.fn factory
- `MarkdownRenderer` — used by `ReleaseManagerContent`; needs `render` (async, no-op return)
- `Setting` — used by Modal builders; fluent API: `setName`, `setDesc`, `addButton`, `addText`, `addToggle`, `addDropdown`, each returning `this`

### Values/namespaces

- `Platform` — `isMobile`, `isDesktop`, `isMacOS`, `isIosApp`, `isAndroidApp` — object with boolean flags (default all `false` except `isDesktop: true`)
- `moment` — minimal; forward to real `moment` package if available, else return a small stub with `format`, `fromNow`, `isValid`, `toDate`

### Functions

- `requestUrl` — jest.fn returning `{ status: 200, headers: {}, text: "", json: {}, arrayBuffer: new ArrayBuffer(0) }` by default; tests override per-case
- `debounce` — important: return a function that invokes immediately OR exposes a `.flush()` — production code uses both. Match Obsidian's signature: `debounce(fn, timeout, resetTimer)` → callable with `.cancel()` and `.run()`. For tests, prefer synchronous execution (no actual setTimeout) so assertions don't need `jest.useFakeTimers`
- `normalizePath` — `(p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/")`  — simple enough to make real
- `setIcon` — jest.fn no-op
- `requireApiVersion` — jest.fn returning `true` by default (tests can override for version-gate branches)
- `getFrontMatterInfo` — return `{ exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 }`
- `parseYaml` — forward to `yaml` package or a minimal `eval`-free parser returning `{}`

### Types (type-only exports — zero runtime cost)

- `CachedMetadata`, `RequestUrlParam`, `RequestUrlResponse`, `RequestUrlResponsePromise`, `EventRef`, `Component`, `EditorView` (CM's, but LiveViews imports from obsidian re-export)

## Design decisions

1. **Vault as EventTarget.** SharedFolder listens on vault events (`create`, `modify`, `delete`, `rename`). The mock `Vault` extends `EventTarget`; `on(event, cb)` registers a listener, returns an `EventRef` object; `off` / `offref` removes it. Tests dispatch `new CustomEvent("modify", { detail: { file } })` to simulate filesystem changes. This mirrors Obsidian's actual event bus more faithfully than a homemade emitter and costs nothing.

2. **Notice exposes `Notice.instances` static array.** Makes `expect(Notice.instances).toContainEqual(...)` trivial in assertions. Clear between tests via `afterEach(() => Notice.instances.length = 0)` or an exported `__resetNotices()` helper.

3. **`debounce` is synchronous by default.** Obsidian's real debounce waits; the mock executes immediately unless the test opts into `jest.useFakeTimers()` and calls a mock-provided `__scheduledDebounces` flush. This eliminates an entire class of "flaky because timer didn't fire" test failures — matches how the production code typically uses debounce (coalescing user input, not rate-limiting).

4. **`requestUrl` is a jest.fn at module level.** Tests `import { requestUrl } from "obsidian"` and `(requestUrl as jest.Mock).mockResolvedValueOnce(...)`. No global network access, no surprise real HTTP. The default return is a 200 with empty body — any test expecting real payload must override.

5. **Class constructors accept `App` as first arg but don't require it.** Match Obsidian's actual API. Tests can pass a pre-built `mockApp()` factory helper.

6. **Provide a `createMockApp()` / `createMockVault()` / `createMockPlugin()` factory exports** alongside the raw classes. Keeps test setup to 1-2 lines instead of 20.

7. **No Svelte-specific wiring.** Svelte components in `__tests__/` import from `obsidian` and the mock catches them transparently — no separate Svelte mock layer needed.

## Files to create/modify

| File | Change | LOC estimate |
|------|--------|--------------|
| `__tests__/mocks/obsidian.ts` | **Create** — full mock module | ~300 |
| `__tests__/mocks/obsidian-factories.ts` | **Create** — `createMockApp`, `createMockVault`, etc. | ~80 |
| `jest.config.js` | **Patch** — add `"^obsidian$"` to `moduleNameMapper` | +1 |
| `__tests__/obsidian-mock.smoke.test.ts` | **Create** — smoke test validating every exported symbol is importable and constructible | ~60 |
| `tsconfig.json` (if strict) | **Check** — may need `"types"` addition or `paths` for test-time resolution | 0-3 |

## Tasks

### Task 1 — Scaffold mock module (Action)

Create `__tests__/mocks/obsidian.ts` with all classes/values/functions listed above. Exports are complete but behavior is minimal — classes have correct shape, functions are jest.fn or identity-ish no-ops. No factory helpers yet.

**Acceptance:** `import * as O from "__tests__/mocks/obsidian"` resolves all 40+ symbols used across the 5 target files without TS errors.

### Task 2 — Wire jest moduleNameMapper (Action)

Add one line to `jest.config.js`:
```js
moduleNameMapper: {
    ...existing,
    "^obsidian$": "<rootDir>/__tests__/mocks/obsidian.ts",
}
```

**Acceptance:** `npm test -- --listTests` succeeds; `jest --showConfig` shows the mapping resolved.

### Task 3 — Write smoke test (Action)

Create `__tests__/obsidian-mock.smoke.test.ts` that imports every exported symbol and constructs every class. Asserts:
- All classes instantiable with no-arg or minimal-arg constructors
- `Notice("x")` records to `Notice.instances`
- `requestUrl` returns the default 200 shape
- `debounce(fn)(arg)` calls `fn(arg)` synchronously

**Acceptance:** Smoke test passes. This is the canary for the harness itself.

### Task 4 — Factory helpers (Action)

Create `__tests__/mocks/obsidian-factories.ts`:
- `createMockApp(overrides?)` — returns `App` with pre-built `vault`, `workspace`, `metadataCache`
- `createMockVault(files?: TFile[])` — pre-seeded vault with event bus wired
- `createMockPlugin(app?)` — returns Plugin with `app`, `manifest`, `loadData` returning `{}`
- `createMockTFile(path, content?)`, `createMockTFolder(path, children?)`

**Acceptance:** A characterization test for `SharedFolder` can get to "SharedFolder instantiated and attached to a vault" in ≤10 lines of setup.

### Task 5 — Verification passes (Gate, before 4b kicks off)

- [ ] `npm test` — smoke test green, `ObservableMap.test.ts` still green (no regression)
- [ ] `tsc -noEmit` — no new errors introduced by mock types
- [ ] Manual import check: open one of the 5 target files in a test scratch file; it type-checks against the mock module
- [ ] Factory helper ergonomics: write one throwaway test for `SyncFile.ts` using only the factories — if setup exceeds 15 lines, factories need expansion before declaring 4a done

## Risk & shaky ground

1. **Svelte + ts-jest ESM + obsidian mock transitive imports.** Svelte components imported by tests compile through svelte-jest (or svelte-preprocess-based ts-jest flow — need to verify which this repo uses). If svelte compiler evaluates `import { Notice } from "obsidian"` at compile time rather than runtime, moduleNameMapper may not intercept. **Mitigation:** Task 1 includes a Svelte-importing smoke test; if it fails, escalate to `svelte-jester` config or per-component `jest.mock("obsidian", ...)` at test top.

2. **`debounce` semantics divergence.** Production code in a few places depends on debounce actually debouncing (e.g., rapid-fire rename → single rename event). Making the mock synchronous simplifies most tests but breaks the handful that test debounce behavior itself. **Mitigation:** Expose `debounce.__mode = "sync" | "async"` module-level switch; tests that verify debounce set it to `"async"` and use fake timers. Document in the mock's top-of-file comment.

3. **Vault event semantics.** Real Obsidian's vault emits events with `(file: TFile)` as the payload; the `on` signature returns an `EventRef` that must be passed to `offref` (not `off`). Getting this subtly wrong means tests pass against the mock but fail against real Obsidian during Phase 4b's optional smoke. **Mitigation:** Smoke test asserts `vault.on("modify", cb)` returns an object with `{id: ...}` shape, and that `vault.offref(ref)` stops the listener from firing. Match Obsidian's API reference exactly.

4. **`moment` is a huge surface.** Tests using `moment` format/parsing will stress the mock. **Mitigation:** Forward to the real `moment` npm package if installed (it already is — it's a dependency of ManageRelay.svelte). The mock re-exports `import moment from "moment"`.

5. **EditorView re-export.** `LiveViews.ts` imports `EditorView` from `"obsidian"` but Obsidian's d.ts re-exports it from `@codemirror/view`. Mock must forward to the real package: `export { EditorView } from "@codemirror/view"`. Verify this package is already a dep before relying on it.

## Estimated effort

Single session — ~300 LOC mock + ~80 LOC factories + ~60 LOC smoke + config patch. If Svelte interop forces per-test `jest.mock`, add 1-2h for each 4b target's setup.

## Open questions

1. Does the repo use `svelte-jester` or another Svelte-jest bridge? `package.json` needs inspection before Task 1 kicks off.
2. Are there any monorepo-shared mocks at `../Relay-monorepo/` level we should hook into, or is this Relay-package-local?
3. Should the mock's Vault dispatch events synchronously (tests assert immediately) or asynchronously (matching real IndexedDB adapter)? Default sync; revisit if tests need to observe async ordering.

## Exit criteria

- `__tests__/obsidian-mock.smoke.test.ts` passes
- `ObservableMap.test.ts` still passes
- `tsc -noEmit` clean
- A characterization test skeleton for any one of the 5 targets compiles and can `new SharedFolder(...)` / `new RelayManager(...)` without throwing during construction
- Plan committed separately from any 4b work so 4a can be reverted cleanly if 4b discovers a blocker
