# pi-supervisor

A [pi](https://pi.dev) extension that supervises the coding agent and steers it toward a defined goal. It observes every conversation turn, injects guiding messages when the agent drifts, and signals when the goal is reached — like a tech lead watching over a dev's shoulder.

> A supervisor as the intelligent overseer keeping the agent on track.

> **Status:** Early release.

<img height="298" alt="image" src="https://github.com/tintinweb/pi-supervisor/raw/master/media/screenshot.png" />



https://github.com/user-attachments/assets/f3b23662-6473-4ac3-82f7-c7f9b64fa7c7

## How It Works

```
/supervise Implement a secure JWT auth system with refresh tokens and full test coverage
```

Then start the conversation normally — the supervisor watches from outside without modifying the agent's context.

The supervisor only sees the active goal, a recent slice of the conversation,
the latest summary if one exists, and recent steering history. It does not
inspect the repo or run tools itself.

If you are not sure how to phrase the goal, ask the agent to draft one for you first. A good draft can be either:

- a single high-signal line for simple work
- a multi-line plain-language brief
- a slightly longer structured brief with sub-goals, phases, priorities, or constraints

1. **After each run** — a separate supervisor LLM analyzes the conversation against the goal (all sensitivities)
2. **Mid-run, between tool calls** — also checks for drift on `medium` and `high` sensitivity and can steer the agent without waiting for it to finish
3. **On completion** — supervisor signals done and stops automatically

The supervisor is a pure outside observer. It runs in a separate in-memory pi session sharing only the API credentials and never touches the main agent's context window or system prompt.

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
| `/supervise <goal>` | Start supervising toward a desired goal |
| `/supervise` or `/supervise settings` | Open the interactive settings panel |
| `/supervise stop` | Stop active supervision |
| `/supervise status` | Open current supervision settings when active |
| `/supervise widget` | Toggle the status widget on/off |
| `/supervise model` | Open the interactive model picker |
| `/supervise model <provider/modelId>` | Set supervisor model directly |
| `/supervise sensitivity <low\|medium\|high>` | Adjust steering aggressiveness |

### Examples

```
/supervise Refactor the auth module to use dependency injection and add 90% test coverage

# If you want help first, ask the agent to draft a goal.
# For example: "Draft a supervision goal for fixing the hook runtime."

# A simple drafted goal might be:
/supervise Fix the hook runtime, keep the change minimal, and leave the supervision loop working cleanly

# A longer drafted goal can be passed through the tool instead of typing it inline.

/supervise model
# Opens pi's model selector — pick any model with a configured API key

/supervise sensitivity low
# Only steer when seriously off track

/supervise stop
```

The agent can also initiate supervision itself by calling the `start_supervision` tool with the goal text directly — useful when it recognises a task needs goal tracking. Once active, supervision is locked: only the user can change or stop it.

That means a good workflow is often:

1. ask the agent to draft a goal
2. start with the highest-level goal on the first line
3. keep it as a one-line goal if that is enough
4. add sub-goals, phases, priorities, or constraints only when they help

## UI

### Settings Panel

Run `/supervise` (no args) or `/supervise settings` to open the interactive settings panel:

- **Model** — shows current model; press Enter to browse all available models
- **Sensitivity** — cycle through `low`/`medium`/`high` with Enter or Space
- **Widget** — toggle visibility
- **Goal** (when active) — shows goal, steer count, and turn count
- **Stop** (when active) — stop supervision directly from the panel

Navigate with arrow keys, Escape to close. Changes are applied on close.

### Live Widget

**Footer** (always visible while supervising):
```
🎯
```

**Widget** (one line, updated live):
```
◉ Supervising · Goal: "Refactor auth module…" · claude-haiku · ↗ 2 · ⟳ turn 4
  The agent has added the DI container but hasn't updated the existing call sites yet…
```

The second line shows the supervisor's reasoning as it streams. Toggle the widget with `/supervise widget`.

## Sensitivity Levels

| Level | When it checks | Confidence threshold | Steering style |
|---|---|---|---|
| `low` | End of each run only | — | Only if seriously off track |
| `medium` (default) | End of run + every 3rd tool cycle mid-run | ≥ 0.90 | On clear drift |
| `high` | End of run + every tool cycle mid-run | ≥ 0.85 | Proactively |

**End-of-run** (`agent_end`): fires once per user prompt after the agent finishes and goes idle. The supervisor must decide `done` or `steer`. Idle `continue` responses are converted into a steer so the run does not stall.

**Mid-run** (`turn_end`): fires after each LLM tool-call cycle while the agent is still working. Steering is injected immediately (interrupting the current run) only when confidence exceeds the threshold. The agent has at least 2 sub-turns to settle before mid-run checks begin.

## Supervisor Model

The supervisor runs on a **separate model** — it can be a cheaper/faster model than the one doing the actual work.

**Resolution order:**
1. Previous session state (persists within a session)
2. `.pi/supervisor-config.json` in the project root (saved by `/supervise model`)
3. Active chat model (`ctx.model`) — so it works out of the box with no configuration
4. Built-in default: `anthropic/claude-haiku-4-5-20251001`

Change at any time with `/supervise model` (interactive picker) or `/supervise model <provider/id>` (direct). If supervision is inactive, the new selection becomes the default for the next `/supervise`. The model is also saved to `.pi/supervisor-config.json` if the `.pi/` directory exists.

## Focus and Goal Discipline

The supervisor is a pure outside observer — it does not modify the agent's system prompt. Goal discipline is enforced entirely through steering messages when the agent drifts. If the agent asks an out-of-scope clarifying question, the supervisor redirects it back to the goal rather than answering.

In practice, the goal should read like a compact run brief, not a full spec. The full goal text is reused on every supervisor check, so it is fine for the goal to be a single line, a multi-line plain-language brief, or a short structured block. A good default is to start with the highest-level goal on the first line, then add sub-goals, phased steps, priorities, or constraints only when they genuinely help the supervisor judge progress and completion. If the wording is not obvious, ask the agent to draft a goal before starting supervision.

## Stagnation Detection

If the supervisor sends **5 consecutive steering messages** without declaring the goal done, it switches to a lenient evaluation mode: if the goal is ≥80% achieved, it declares done rather than looping forever on minor improvements. The threshold is configurable via `MAX_IDLE_STEERS` in `src/index.ts`.

## Customizing the Supervisor: SUPERVISOR.md

The supervisor's reasoning is controlled by its **system prompt** — not the goal. The goal is always set at runtime via `/supervise <goal>`. `SUPERVISOR.md` defines *how* the supervisor thinks: its rules, persona, and project-specific constraints.

**Discovery order** (mirrors pi's `SYSTEM.md` convention):

| Priority | Location | Use for |
|---|---|---|
| 1 | `.pi/SUPERVISOR.md` | Project-specific rules |
| 2 | `~/.pi/agent/SUPERVISOR.md` | Global personal rules |
| 3 | Built-in template | Fallback |

The active source is shown when you start supervision with `/supervise <goal>`.

### Built-in system prompt

The default prompt the supervisor uses when no `SUPERVISOR.md` is found:

```
You are a supervisor monitoring a coding AI assistant conversation.
Your job: ensure the assistant fully achieves a specific outcome without needing the human to intervene.

═══ WHEN THE AGENT IS IDLE (finished its turn, waiting for user input) ═══
This is your most important moment. The agent has stopped and is waiting.
You MUST choose "done" or "steer". Never return "continue" when the agent is idle.

- "done"  → only when the outcome is completely and verifiably achieved.
- "steer" → everything else: incomplete work, partial progress, open questions, waiting for confirmation.

If the agent asked a clarifying question or needs a decision:
  FIRST check: is this question necessary to achieve the goal?
  - YES (directly blocks goal progress): answer with a sensible default and tell agent to proceed.
  - NO (out of scope, nice-to-have, unrelated feature): do NOT answer it. Redirect:
    "That's outside the scope of the goal. Focus on: [restate the specific missing piece]."
  DO NOT answer: passwords, credentials, secrets, anything requiring real user knowledge.

Your steer message speaks AS the user. Make it clear, direct, and actionable (1–3 sentences).
Do not ask the agent to verify its own work — tell it what to do next.

═══ WHEN THE AGENT IS ACTIVELY WORKING (mid-turn) ═══
Only intervene if it is clearly heading in the wrong direction.
Trust the agent to complete what it has started. Avoid interrupting productive work.

═══ STEERING RULES ═══
- Be specific: reference the outcome, missing pieces, or the question being answered.
- Never repeat a steering message that had no effect — escalate or change approach.
- A good steer answers the agent's question OR redirects to the missing piece of the outcome.
- If the agent is taking shortcuts to satisfy the goal without properly achieving it, always steer and remind it not to take shortcuts.

"done" CRITERIA: The core outcome is complete and functional. Minor polish, style tweaks, or
optional improvements do NOT block "done". Prefer stopping when the goal is substantially
achieved rather than looping forever chasing perfection.

Respond ONLY with valid JSON — no prose, no markdown fences.
Response schema (strict JSON):
{
  "action": "continue" | "steer" | "done",
  "message": "...",     // Required when action === "steer"
  "reasoning": "...",   // Brief internal reasoning
  "confidence": 0.85    // Float 0-1
}
```

### Writing a custom SUPERVISOR.md

You must preserve the JSON response schema. Everything else is up to you.

```markdown
You are a supervisor for a TypeScript project. Your priorities: type safety and test coverage.

Rules:
- Steer if the agent uses `any` types or skips tests for new code
- When steering, be direct: one sentence max, reference the specific file/function if possible
- "done" only when the new code has types and tests — not before
- Do not steer about code style, naming, or documentation

Response schema (strict JSON, required):
{
  "action": "continue" | "steer" | "done",
  "message": "...",
  "reasoning": "...",
  "confidence": 0.85
}
```

## Session Persistence

Supervision state (outcome, model, sensitivity, intervention history) is stored in the pi session file and restored automatically on restart, session switch, fork, and tree navigation.

## Project Structure

```
src/
  index.ts              # Extension entry point, event wiring, /supervise command, start_supervision tool
  types.ts              # SupervisorState, SteeringDecision, ConversationMessage
  state.ts              # SupervisorStateManager — in-memory state + session persistence
  engine.ts             # Snapshot building, SUPERVISOR.md loading, prompt construction, analyze()
  model-client.ts       # One-shot supervisor LLM calls via pi's AgentSession API
  workspace-config.ts   # .pi/supervisor-config.json read/write for model persistence
  ui/
    status-widget.ts    # 🎯 footer badge + one-line widget with live thinking stream
    model-picker.ts     # Interactive model picker using pi's ModelSelectorComponent
    settings-panel.ts   # Interactive settings overlay using pi-tui's SettingsList
```

## License

MIT — [tintinweb](https://github.com/tintinweb)
