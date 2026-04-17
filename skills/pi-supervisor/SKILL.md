---
name: pi-supervisor
description: Use when the user wants the current Pi session kept on track toward a concrete goal, especially for longer or drift-prone work. Helps draft a supervision goal, start supervision, adjust settings, and decide when to customise SUPERVISOR.md.
---

# Pi-Supervisor Skill

Use this when the user wants ongoing oversight of the current Pi coding
session.

Typical triggers:

- keep this on track
- watch progress
- make sure this gets finished
- steer if you drift
- supervise this run

Use this skill when:

- the user wants ongoing supervision across a multi-turn coding task
- the task is long, drift-prone, or needs a strong completion bar
- the user wants the agent kept focused on a concrete goal
- the user wants help drafting a supervision goal before deciding whether to start

Do not use this skill when:

- the user only wants a one-off answer
- the task is tiny and supervision would be overhead
- do not **start supervision** if the user only wants wording help
- do not replace or restart active supervision unless the user asks

Three common modes:

1. **Explain** — explain what supervision is, when it helps, and how it works.
2. **Draft** — draft a compact supervision goal without starting supervision yet.
3. **Start** — start supervision once the user explicitly asks, or clearly delegates that action.

Default agent behaviour:

1. Distil the desired goal into one clear first line.
2. Add constraints or priorities only if they change what counts as done.
3. If the user explicitly asks to start supervision, or clearly delegates that action, start it.
4. If supervision is already active, help with status, settings, or goal-change guidance instead of replacing it yourself.
5. Tell the user how to stop or adjust it.

## What supervision is

Think of `pi-supervisor` as a lightweight external reviewer for the current
run.

- it is a second model watching from outside the main run
- it does not carry the task itself or replace the main agent
- it sees a limited context bundle, not the whole transcript
- it judges progress against the active goal text
- it can either let the agent continue, inject a steer, or declare the goal
  done when the agent is idle
- a steer is injected as if it came from the user
- each supervisor check is a fresh one-shot evaluation, not a persistent
  supervisor conversation
- it has no tools or skills of its own during these checks
- it does not inspect the repo or run tools itself

That mental model matters because the supervisor is not reading your whole run
from scratch on every check. It is making repeated judgments from a focused
brief and a recent slice of the conversation.

## Core idea

- `SUPERVISOR.md` tells the supervisor **how** to supervise
- the goal tells the supervisor **what this run is trying to achieve**
- the full goal text is appended again on each supervisor check, so it should
  be high-signal and able to stand on its own
- the goal can be a single line, a multi-line plain-language brief, or a
  longer block of text using paragraphs, bullets, numbered lists, or
  lightweight markdown-style headings

Most of the time, start with a short inline goal. For more complex cases, ask
the agent to start supervision with a longer structured goal.

If the target is fuzzy, draft a one-line goal first. That draft can stay as a
single line or expand into a multi-line plain-language brief or a slightly
longer structured goal.

## Using pi-supervisor

### Start with inline text

Start supervision with inline text:

```text
/supervise Fix the hook runtime and keep the change minimal
```

After that, the conversation continues normally while the supervisor watches in
the background.

### Start through the agent

If the user clearly wants supervision and the goal is ready, start supervision
yourself through the `start_supervision` tool.

The internal tool parameter is named `outcome`, but the user-facing concept is
the **goal**.

For example:

```text
Draft a supervision goal for fixing the hook runtime.
```

The drafted goal might be a one-line goal or a short structured brief.

Once supervision is active, only the user can change or stop it.

If the user wants a materially different goal mid-run, advise stopping and
restarting supervision with the new goal rather than silently swapping it.

Also note:

- `/supervise status` opens the settings panel when supervision is active
- `/supervise` or `/supervise settings` opens the settings panel directly

Recommended pattern:

- start with the highest-level goal on the first line
- add sub-goals, phases, priorities, or constraints only when they help

Quick checklist:

- one clear line first
- add constraints only if they affect judgement
- add structure only when it helps completion decisions
- write the goal so it stands on its own

For example, ask it to start supervision with a goal like:

```text
Fix the hook runtime.

Priorities:
- Fix startup reliability
- Stop stale widget state
- Prove one clean supervision cycle

Constraints:
- Keep the change minimal
- Do not add new workflow machinery
```

### Other useful commands

Other useful commands:

```text
/supervise status
/supervise stop
/supervise model
/supervise widget
/supervise sensitivity medium
```

## Understanding SUPERVISOR.md

`SUPERVISOR.md` is the supervision behaviour prompt.

There is always one effective supervisor prompt for a run. The package resolves
it in this order:

1. `.pi/SUPERVISOR.md` in the current project
2. `~/.pi/agent/SUPERVISOR.md` as a personal global default
3. the built-in default supervisor prompt shipped with the package

So `SUPERVISOR.md` is not an extra prompt layered on top of some other default.
If a project or global `SUPERVISOR.md` exists, that becomes the supervisor
prompt. Otherwise the built-in default is used.

Use it to shape how the supervisor reasons, for example:

- what quality bar matters most
- how strict the supervisor should be about completion
- which kinds of drift deserve steering

The run goal is separate. The goal says what this run is trying to achieve.

Quick rule of thumb:

| Put in the goal | Put in `SUPERVISOR.md` |
|---|---|
| what this run should achieve | how strict the supervisor should be |
| run-specific constraints | project-wide quality bar |
| current priorities or phase | what kinds of drift matter most |
| concrete done criteria | steering style and completion policy |

The goal can be a single sentence or a longer block of text. Markdown-style
structure is fine, but it is still just goal text. What matters is that it
gives the supervisor enough context to judge progress.

### When to customise `SUPERVISOR.md`

Good reasons to customise it:

- you want a stricter or looser bar for calling work done
- you want the supervisor to care more about tests, simplicity, or minimal diffs
- you want to change how proactive steering feels
- you want to define what kinds of drift matter most in this project

Keep run-specific instructions in the goal instead.

Also preserve the expected JSON response contract. A custom
`SUPERVISOR.md` still needs to instruct the supervisor to return the required
strict JSON shape.

Mini example:

```markdown
You are a supervisor for a TypeScript project.

Rules:
- Steer if new code skips tests.
- Prefer minimal diffs.
- Do not steer about naming or style.

Respond ONLY with the required strict JSON schema.
```

## What context the supervisor sees

On each supervisor check, the supervisor does not read the whole session from
scratch. It gets a focused context bundle made of:

- the effective supervisor prompt from `SUPERVISOR.md` or the built-in default
- the active goal text
- a recent conversation window
- the most recent compaction or branch summary, if Pi has created one
- recent supervisor interventions
- whether the agent is idle or still working

The supervisor judges only from that supplied context. It does not inspect the
repo or gather new evidence itself, so goals work best when the completion
signals are observable in the conversation, for example “fix X and add
regression tests for Y” rather than “make X better”.

File references in the goal can still be useful as anchors, for example
`plans/foo.md`, but the supervisor does not open those files itself. In those
cases it can still steer the worker to read the governing artifact, follow it,
and keep it updated as the run progresses.

### Recent conversation window

In the current implementation, the supervisor sees only the last few
user/assistant messages from the session branch:

- `low` sensitivity: last **6** messages
- `medium` sensitivity: last **12** messages
- `high` sensitivity: last **20** messages

This is a recent message window, not the full transcript.

### Compaction summary

If Pi has already created a `compaction` or `branch_summary` entry for older
history, the supervisor also gets the most recent summary text from that entry.

That summary gives the supervisor compressed older context that sits outside the
recent message window.

### What this means at the start

On the first supervision loop, the amount of prior conversation context is
variable.

- if supervision starts after the session already has some history, the
  supervisor can see the recent slice of that history
- if supervision starts early, there may be very little useful prior context
- if no compaction or branch summary exists yet, there is no older-history
  summary to include

That is why the goal should usually stand on its own. It is not just a label.
It often carries much of the initial context the supervisor needs.

## How to write a goal

Keep the goal readable and concrete.

Think of the goal as a short run brief.

The full active goal is appended again on each supervisor check, so high-signal
and compact works better than long project-document style input.

In general, keep it short unless extra detail is truly necessary.

Good goals usually make these things easy to see:

- the primary objective
- concrete done criteria
- any important constraints

The goal does not need a rigid schema.

Most of the time, inline text is enough.

If you are unsure, ask the agent to draft a goal first and then either
use that one-liner directly or expand it into a multi-line brief or short
structured goal.

A good default is:

- start with the highest-level goal first
- keep it to one line if that is enough
- add sub-goals, phased steps, priorities, or constraints only when they help
  the supervisor judge progress and completion

Useful default template:

```text
Fix the hook runtime while keeping the change minimal.

Done when:
- startup is reliable
- stale widget state is gone
- one clean supervision cycle works

Constraints:
- keep the diff small
- do not add new workflow machinery
```

Weak vs stronger examples:

- weak: `Work on auth`
- weak: `Make the hook runtime better`
- stronger: `Fix the hook runtime, keep the change minimal, and leave one clean supervision cycle.`
- stronger: `Refactor auth dependency injection, keep behaviour unchanged, and add regression tests for login and refresh.`

If the agent starts supervision itself through the tool, it can supply the goal
text on the fly. For more complex goals, paragraphs, bullet points, numbered
lists, and markdown-style headings are all fine.

### Common goal forms

#### 1. Inline goal

```text
Fix the hook runtime, keep the change small, and leave the supervisor loop working cleanly.
```

#### 2. Longer structured goal text

```text
Fix the hook runtime while keeping the change minimal and leaving the supervisor loop working cleanly.

Priorities:
- Fix startup reliability.
- Stop stale widget state.
- Prove one clean supervision cycle.

Constraints:
- Keep the change minimal.
- Do not add new workflow machinery.
```

For multi-step work, plain paragraphs, bullets, numbered lists, and lightweight
markdown-style structure are enough. The runtime does not
need a formal schema to use the goal well.

## Multi-line goals, sub-goals, and phased goals

Multi-line and structured goals are fine, but the runtime does not parse
sub-goals or phases formally.

That means:

- bullets and headings help the model read the goal
- the supervisor still infers progress from plain language each time
- there is no built-in phase tracker or sub-goal state machine

Practical guidance:

- use sub-goals only when they help the supervisor judge completion
- phased goals work best when they are ordered checkpoints toward one end-state
- if the work really contains multiple distinct objectives or a likely scope
  shift, prefer separate supervision runs over one overloaded goal

## Sensitivity guidance

Use:

- `low` for minimal interruption
- `medium` as the default
- `high` for brittle, tightly scoped work where drift is costly

## Goal opening line and truncation

The widget shows the start of the active goal.

The widget truncates long goals, and the TUI may shorten the displayed line
again if space is tight.

That means the opening line matters.

- for inline goals, put the clearest version of the goal first
- for longer structured goals, make the first line a short one-line goal
- if the goal has more detail, put it after that first line

Suggested pattern for longer goals:

```text
Fix the hook runtime while keeping the change minimal and leaving the supervisor loop working cleanly.

Priorities:
- ...
```
