# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-05-31

### Changed
- **Breaking**: pi runtime packages migrated from the `@mariozechner/*` scope to `@earendil-works/*`. Peer deps are now `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, with the floor raised to `>=0.74.0`. Import paths in `src/` updated accordingly.
- CI now runs on Node 22 (was Node 20).

## [0.4.3] - 2026-05-04

No user-facing behavior changes.

### Changed
- Adapted to `@mariozechner/pi-coding-agent@0.72.x` API:
  - `session_switch` and `session_fork` events consolidated into `session_start` (with `reason` field) — listener removed, behavior unchanged
  - `DefaultResourceLoader` now requires `cwd`/`agentDir`; `systemPromptOverride: () => string` renamed to `systemPrompt: string`
- Migrated `@sinclair/typebox@latest` → `typebox@^1.1.24` and pinned to a stable major (was previously `latest`, which would silently pull breaking changes on install)

### Added
- CI pipeline (`.github/workflows/ci.yml`) running lint, typecheck, and tests on push/PR to `master`
- Biome linter config (`biome.json`)
- Vitest test suite (`test/`) — 38 tests covering pure helpers in `model-client`, `engine`, `state`, and `workspace-config`
- npm scripts: `build`, `test`, `test:watch`, `typecheck`, `lint`, `lint:fix`, `prepublishOnly`

## [0.4.2] - 2026-03-11

### Added
- **Interactive settings panel** — `/supervise` (no args) and `/supervise settings` now open a navigable settings UI built on pi-tui's `SettingsList` component instead of printing static text
  - Arrow keys to navigate, Enter/Space to cycle values or open submenus, Escape to close
  - **Model**: Enter opens the full interactive model picker as a submenu
  - **Sensitivity**: cycles through `low`/`medium`/`high` with contextual descriptions
  - **Widget**: toggles visibility inline
  - **Outcome** (when active): displays current goal with steer/turn counts
  - **Stop Supervision** (when active): confirm to stop directly from the panel
- `/supervise status` now also opens the interactive settings panel when supervision state exists

## [0.4.1] - 2026-02-22

### Changed
- Updated `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, and `@mariozechner/pi-tui` to 0.54.1

## [0.4.0] - 2026-02-22

### Added
- **`start_supervision` tool** — the agent can initiate supervision itself; once active it is locked and only the user can change or stop it via `/supervise`
- **`/supervise widget`** subcommand — toggle the status widget on/off
- **Workspace model persistence** — supervisor model saved to `.pi/supervisor-config.json` when `.pi/` exists; loaded automatically on next session
- **Streaming thinking** — supervisor reasoning streams live as a second line in the widget while analyzing
- **Stagnation detection** — after 5 consecutive steering messages with no `done`, switches to lenient evaluation (≥80% achieved → done) to avoid infinite loops
- **Mid-run steering for `medium` sensitivity** — checks every 3rd tool cycle (turns 2, 5, 8, …), confidence ≥ 0.90
- **Shortcut detection** — supervisor always steers when the agent takes shortcuts to satisfy the goal without properly achieving it

### Changed
- **Sensitivity reworked** — levels now control both *when* to check and *how confidently* to steer:
  - `low`: end-of-run only, no mid-run checks
  - `medium`: end-of-run + every 3rd tool cycle (confidence ≥ 0.90)
  - `high`: end-of-run + every tool cycle (confidence ≥ 0.85)
- **`/supervise <outcome>` no longer auto-starts the agent** — supervision is set up first; the user starts the conversation separately, giving full control over the opening prompt
- **Supervisor is now a pure outside observer** — removed system prompt injection (`before_agent_start`); the agent runs completely unmodified and the supervisor steers only through user messages
- **Footer simplified** — `🎯` emoji replaces the `[SUPERVISING]` text label
- **Model fallback chain** — session state → `.pi/supervisor-config.json` → active chat model → built-in default
- **Dead `ANALYSIS_INTERVAL` code removed** — `agent_end` always fires once per user prompt with the agent idle; the interval throttle was never reachable
- Desired outcome repeated at the bottom of every supervisor analysis prompt to keep it prominent in long conversations

### Fixed
- Steering loop was broken: `deliverAs: "followUp"` does not trigger a new turn when the agent is already idle; removed to use plain `sendUserMessage`

## [0.3.0] - 2026-02-21

Initial release of `pi-supervisor`.

### Added
- **Supervisor engine** — observes every agent turn and calls a configurable LLM to evaluate progress toward a user-defined outcome
- **`/supervise <outcome>`** — activate supervision with a natural-language goal
- **`/supervise stop`** — deactivate supervision
- **`/supervise status`** — show outcome, model, sensitivity, and intervention history
- **`/supervise model`** — interactive model picker using pi's internal `ModelSelectorComponent` (same UI as Ctrl+P)
- **`/supervise model <provider/modelId>`** — set supervisor model directly for scripting
- **`/supervise sensitivity <low|medium|high>`** — control how aggressively the supervisor steers
- **Separate supervisor model** — runs in an isolated in-memory pi `AgentSession`, independent from the chat model; uses the same API credentials via `ctx.modelRegistry`
- **Steering** — injects follow-up user messages when the agent drifts; supervision stops automatically when the goal is achieved
- **`SUPERVISOR.md` support** — custom supervisor system prompt loaded from `.pi/SUPERVISOR.md` (project) or `~/.pi/agent/SUPERVISOR.md` (global), falling back to the built-in template; mirrors pi's `SYSTEM.md` discovery convention
- **Session persistence** — supervision state (outcome, model, sensitivity, interventions) stored in the session file and restored on restart, session switch, fork, and tree navigation
- **Footer status** — always-visible one-liner showing outcome, model, and steer count while supervising
- **Widget** — shows goal, model, and recent interventions above the editor

[0.5.0]: https://github.com/tintinweb/pi-supervisor/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/tintinweb/pi-supervisor/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/tintinweb/pi-supervisor/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/tintinweb/pi-supervisor/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/tintinweb/pi-supervisor/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/tintinweb/pi-supervisor/releases/tag/v0.3.0
