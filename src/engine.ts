/**
 * engine — supervisor analysis logic.
 *
 * Builds conversation snapshots from session history,
 * constructs prompts, and calls the supervisor model.
 *
 * System prompt discovery order (mirrors pi's SYSTEM.md convention):
 *   1. <cwd>/.pi/SUPERVISOR.md   — project-local
 *   2. ~/.pi/agent/SUPERVISOR.md — global
 *   3. Built-in template         — fallback
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ConversationMessage, SteeringDecision, SupervisorState } from "./types.js";
import { callSupervisorModel } from "./model-client.js";

// ---- System prompt loading ----

const SUPERVISOR_MD = "SUPERVISOR.md";
const CONFIG_DIR = ".pi";
const GLOBAL_AGENT_DIR = join(homedir(), ".pi", "agent");

/** Built-in fallback system prompt. */
const BUILTIN_SYSTEM_PROMPT = `You are a supervisor monitoring a coding AI assistant conversation.
Your job: ensure the assistant fully achieves a specific outcome without needing the human to intervene.

═══ WHEN THE AGENT IS IDLE (finished its turn, waiting for user input) ═══
This is your most important moment. The agent has stopped and is waiting.
You MUST choose "done" or "steer". Never return "continue" when the agent is idle.

- "done"  → only when the outcome is completely and verifiably achieved.
- "steer" → everything else: incomplete work, partial progress, open questions, waiting for confirmation.

If the agent asked a clarifying question or needs a decision, answer it directly:
  SAFE to answer on the user's behalf: technical choices, style preferences, "should I also do X",
  continuation prompts ("shall I proceed?"), reasonable assumptions.
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
}`;

/**
 * Load the supervisor system prompt.
 * Checks .pi/SUPERVISOR.md (project) then ~/.pi/agent/SUPERVISOR.md (global),
 * falling back to the built-in template if neither exists.
 * Returns both the prompt and its source path (or "built-in").
 */
export function loadSystemPrompt(cwd: string): { prompt: string; source: string } {
  const projectPath = join(cwd, CONFIG_DIR, SUPERVISOR_MD);
  if (existsSync(projectPath)) {
    return { prompt: readFileSync(projectPath, "utf-8").trim(), source: projectPath };
  }

  const globalPath = join(GLOBAL_AGENT_DIR, SUPERVISOR_MD);
  if (existsSync(globalPath)) {
    return { prompt: readFileSync(globalPath, "utf-8").trim(), source: globalPath };
  }

  return { prompt: BUILTIN_SYSTEM_PROMPT, source: "built-in" };
}

const MESSAGE_LIMITS: Record<string, number> = {
  low: 6,
  medium: 12,
  high: 20,
};

/** Extract recent user/assistant messages from the session branch. */
function buildSnapshot(ctx: ExtensionContext, limit: number): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const msg = (entry as any).message;
    if (!msg) continue;

    if (msg.role === "user") {
      const content = extractText(msg.content);
      if (content) messages.push({ role: "user", content: content.slice(0, 2000) });
    } else if (msg.role === "assistant") {
      const content = extractAssistantText(msg.content);
      if (content) messages.push({ role: "assistant", content: content.slice(0, 2000) });
    }
  }

  // Return the most recent N messages
  return messages.slice(-limit);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text as string)
      .join("\n")
      .trim();
  }
  return "";
}

function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const textParts = content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text as string);
  return textParts.join("\n").trim();
}

/** Build the user-facing prompt for the supervisor LLM. */
function buildUserPrompt(
  state: SupervisorState,
  snapshot: ConversationMessage[],
  agentIsIdle: boolean,
  stagnating: boolean
): string {
  const interventionHistory =
    state.interventions.length === 0
      ? "None yet."
      : state.interventions
          .slice(-5)
          .map((iv, i) => `[${i + 1}] Turn ${iv.turnCount}: "${iv.message}"`)
          .join("\n");

  const conversationText =
    snapshot.length === 0
      ? "(No conversation yet)"
      : snapshot
          .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
          .join("\n\n---\n\n");

  const agentStatus = agentIsIdle
    ? `AGENT STATUS: IDLE — the agent has finished its turn and is now waiting for user input.
You MUST return "done" or "steer". Returning "continue" here means the agent stays idle forever.`
    : `AGENT STATUS: WORKING — the agent is actively processing. Only intervene if clearly off track.`;

  const stagnationWarning = stagnating
    ? `\n⚠ STAGNATION: The supervisor has sent ${state.interventions.length} steering messages with no "done" verdict.
The agent is making diminishing improvements. Apply a lenient standard:
- If the core goal is substantially achieved (≥80%), return "done".
- Only return "steer" if a CRITICAL piece is still missing — not minor polish.
- Prefer stopping over looping forever on perfection.`
    : "";

  return `DESIRED OUTCOME:
${state.outcome}

SENSITIVITY: ${state.sensitivity}
(low = only steer if seriously off track; medium = steer on mild drift; high = steer proactively)

${agentStatus}${stagnationWarning}

RECENT CONVERSATION (last ${snapshot.length} messages):
${conversationText}

PREVIOUS INTERVENTIONS BY YOU:
${interventionHistory}

Analyze the conversation and the agent's current state. Has the outcome been fully achieved?
Respond with JSON only.`;
}

/**
 * Analyze the current conversation and return a steering decision.
 * Falls back to { action: "steer" } when the agent is idle to prevent it from staying stuck.
 */
export async function analyze(
  ctx: ExtensionContext,
  state: SupervisorState,
  agentIsIdle: boolean,
  stagnating: boolean,
  signal?: AbortSignal,
  onDelta?: (accumulated: string) => void
): Promise<SteeringDecision> {
  const { prompt: systemPrompt } = loadSystemPrompt(ctx.cwd);

  const limit = MESSAGE_LIMITS[state.sensitivity] ?? 12;
  const snapshot = buildSnapshot(ctx, limit);
  const userPrompt = buildUserPrompt(state, snapshot, agentIsIdle, stagnating);

  try {
    return await callSupervisorModel(ctx, state.provider, state.modelId, systemPrompt, userPrompt, signal, onDelta);
  } catch {
    // When idle and analysis fails, nudge rather than silently do nothing
    return agentIsIdle
      ? { action: "steer", message: "Please continue working toward the goal.", reasoning: "Analysis error", confidence: 0 }
      : { action: "continue", reasoning: "Analysis error", confidence: 0 };
  }
}
