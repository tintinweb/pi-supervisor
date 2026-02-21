# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-02-21

Complete rewrite. The extension is now `pi-supervisor` — a chat supervision tool rather than a todo list manager.

### Added
- **Supervisor engine** — observes every agent turn and calls a configurable LLM to evaluate progress toward a user-defined outcome
- **`/supervise <outcome>`** — activate supervision with a natural-language goal
- **`/supervise stop`** — deactivate supervision
- **`/supervise status`** — show outcome, model, sensitivity, and intervention history
- **`/supervise model`** — interactive model picker using pi's internal `ModelSelectorComponent` (same UI as Ctrl+P)
- **`/supervise model <provider/modelId>`** — set supervisor model directly for scripting
- **`/supervise sensitivity <low|medium|high>`** — control how aggressively the supervisor steers
- **Separate supervisor model** — runs in an isolated in-memory pi `AgentSession`, independent from the chat model; uses the same API credentials via `ctx.modelRegistry`
- **Steering** — injects short follow-up user messages via `pi.sendUserMessage({ deliverAs: "followUp" })` when the agent drifts
- **Outcome detection** — supervisor signals `done` when the goal is fully achieved; supervision stops automatically
- **System prompt injection** — adds outcome reminder to the agent's system prompt via `before_agent_start` each turn
- **`SUPERVISOR.md` support** — custom supervisor system prompt loaded from `.pi/SUPERVISOR.md` (project) or `~/.pi/agent/SUPERVISOR.md` (global), falling back to the built-in template; mirrors pi's `SYSTEM.md` discovery convention
- **Session persistence** — supervision state (outcome, model, sensitivity, interventions) stored in the session file and restored on restart, session switch, fork, and tree navigation
- **Footer status** — always-visible one-liner showing outcome, model, and steer count while supervising
- **Widget** — shows goal, model, and recent interventions above the editor

### Removed
- `manage_todo_list` tool and all todo-list functionality (moved to its own package)
- `/todos` and `/todos clear` commands

### Changed
- Package renamed from `pi-manage-todo-list` to `pi-supervisor`

## [0.2.0] - 2026-02-16

### Changed
- **Breaking**: Removed max one in-progress validation to support parallel work and subagents
- Enhanced success message to include progress stats and explicit continuation instructions
- Updated tool description to reflect support for multiple in-progress items

### Added
- Small list warning when todo list has fewer than 3 items
- Progress tracking in success messages

### Fixed
- Validation now allows multiple todos to be in-progress simultaneously for better subagent support

## [0.1.0] - 2026-02-15

### Added
- Initial release of pi-manage-todo-list extension
- Core `manage_todo_list` tool with read/write operations
- TodoItem schema with id, title, description, and status fields
- Live widget showing real-time progress above editor
- Session persistence across switches, forks, and tree navigation
- User commands: `/todos` and `/todos clear`

[0.3.0]: https://github.com/tintinweb/pi-supervisor/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/tintinweb/pi-supervisor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/tintinweb/pi-supervisor/releases/tag/v0.1.0
