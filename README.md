# pi-supervisor

A [pi](https://pi.dev) extension that supervises the coding agent and steers it toward a defined outcome. It observes every conversation turn, injects guiding messages when the agent drifts, and signals when the goal is reached — like a tech lead watching over a dev's shoulder.

> **Status:** Early release.

## How It Works

```
/supervise Implement a secure JWT auth system with refresh tokens and full test coverage
```

1. **Every turn** — supervisor LLM (separate from the chat model) analyzes the conversation
2. **On drift** — injects a short steering message as a follow-up user message
3. **On completion** — notifies you and stops automatically

The supervisor runs invisibly in a separate in-memory pi session using the same API credentials as the main chat. It never interrupts mid-turn; it waits for the agent to finish, then nudges if needed.

## Install

```bash
pi install npm:pi-supervisor
```

Or load directly for development:

```bash
pi -e ~/projects/pi-supervisor/src/index.ts
```

## Commands

| Command | Description |
|---|---|
| `/supervise <outcome>` | Start supervising toward a desired outcome |
| `/supervise stop` | Stop active supervision |
| `/supervise status` | Show current outcome, model, intervention history |
| `/supervise model` | Open the interactive model picker |
| `/supervise model <provider/modelId>` | Set supervisor model directly |
| `/supervise sensitivity <low\|medium\|high>` | Adjust how aggressively to steer |

### Examples

```
/supervise Refactor the auth module to use dependency injection and add 90% test coverage

/supervise model
# Opens pi's model selector — pick any model with a configured API key

/supervise sensitivity low
# Only steer when seriously off track

/supervise stop
```

## UI

**Footer** (always visible while supervising):
```
[SUPERVISING] → "Refactor auth module to use dep…" | claude-haiku-4-5-20251001 | 2 steers
```

**Widget** (shown by `/supervise status`):
```
[SUPERVISING] anthropic/claude-haiku-4-5-20251001 · 2 steers
Goal: "Refactor auth module to use dependency injection and ad…"
Recent steers:
  · Add error handling to the token refresh path
  · Don't forget to update the integration tests
```

## Sensitivity Levels

| Level | Behavior |
|---|---|
| `low` | Steer only when seriously off track |
| `medium` | Steer on mild drift (default) |
| `high` | Steer proactively, even for minor deviations |

## Supervisor Model

The supervisor runs on a **separate model** from your coding session — it doesn't pollute your agent's context window and can use a cheaper/faster model.

Default: `anthropic/claude-haiku-4-5-20251001`

Change it at any time with `/supervise model` (interactive picker) or `/supervise model <provider/id>` (direct). The setting persists for the session.

## Customizing the System Prompt

The supervisor's behavior is controlled by its system prompt. Discovery order mirrors pi's `SYSTEM.md` convention:

| Priority | Location |
|---|---|
| 1 | `.pi/SUPERVISOR.md` in project root |
| 2 | `~/.pi/agent/SUPERVISOR.md` globally |
| 3 | Built-in template (fallback) |

Create `.pi/SUPERVISOR.md` to customize how the supervisor reasons and steers for your project. The file must preserve the JSON response schema so the extension can parse decisions:

```markdown
You are a supervisor for a TypeScript project. Focus on type safety and test coverage.

Rules:
- Only steer if the agent skips tests or uses `any` types
- When steering, be direct: one sentence, specific line/file reference if possible
- "done" only when tests pass and types are clean

Response schema (strict JSON):
{
  "action": "continue" | "steer" | "done",
  "message": "...",
  "reasoning": "...",
  "confidence": 0.85
}
```

The active prompt source is shown when you run `/supervise <outcome>` or `/supervise status`.

## Session Persistence

Supervision state (outcome, model, sensitivity, intervention history) is stored in the pi session file and restored automatically on restart, session switch, and fork.

## Project Structure

```
src/
  index.ts              # Extension entry point, event wiring, /supervise command
  types.ts              # SupervisorState, SteeringDecision, ConversationMessage
  state.ts              # SupervisorStateManager — in-memory state + session persistence
  engine.ts             # Conversation snapshot, SUPERVISOR.md loading, prompt building
  model-client.ts       # One-shot supervisor LLM calls via pi's AgentSession API
  ui/
    status-widget.ts    # Footer status line + widget
    model-picker.ts     # Interactive model picker using pi's ModelSelectorComponent
```

## License

MIT — [tintinweb](https://github.com/tintinweb)
