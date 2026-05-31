/**
 * model-client — calls the supervisor LLM using pi's internal agent session API.
 *
 * callModel        — low-level: returns raw response text
 * callSupervisorModel — high-level: parses response as SteeringDecision
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SteeringDecision } from "./types.js";

/**
 * Run a one-shot LLM call using pi's internal agent session.
 * Returns the raw response text, or null on failure.
 */
export async function callModel(
  ctx: ExtensionContext,
  provider: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
  onDelta?: (accumulated: string) => void
): Promise<string | null> {
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) return null;

  // pi-coding-agent 0.72.x requires cwd + agentDir on the loader and
  // renamed `systemPromptOverride: () => string` → `systemPrompt: string`.
  const loader = new DefaultResourceLoader({
    cwd: ctx.cwd,
    agentDir: getAgentDir(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt,
  });
  await loader.reload();

  let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  try {
    const result = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      modelRegistry: ctx.modelRegistry,
      model,
      tools: [],
      resourceLoader: loader,
    });
    session = result.session;
  } catch {
    return null;
  }

  const onAbort = () => session.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  let responseText = "";
  const unsubscribe = session.subscribe((event) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    ) {
      responseText += event.assistantMessageEvent.delta;
      onDelta?.(responseText);
    }
  });

  try {
    await session.prompt(userPrompt);
  } catch {
    return null;
  } finally {
    unsubscribe();
    signal?.removeEventListener("abort", onAbort);
    session.dispose();
  }

  return responseText;
}

/**
 * Run a one-shot supervisor analysis.
 * Returns { action: "continue" } on any failure so the chat is never interrupted.
 */
export async function callSupervisorModel(
  ctx: ExtensionContext,
  provider: string,
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
  onDelta?: (accumulated: string) => void
): Promise<SteeringDecision> {
  const text = await callModel(ctx, provider, modelId, systemPrompt, userPrompt, signal, onDelta);
  if (text === null) return safeContinue("Model call failed");
  return parseDecision(text);
}

// ---- Response parsing ----

/**
 * Parse a supervisor LLM response into a SteeringDecision.
 * Tolerates: bare JSON, ```json fenced blocks, JSON wrapped in prose.
 * Falls back to {action: "continue", confidence: 0} on any parse failure or
 * invalid action — the chat is never interrupted by a malformed response.
 *
 * Exported for unit tests; not part of the public extension contract.
 */
export function parseDecision(text: string): SteeringDecision {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch?.[1] ?? text.trim();

  try {
    const parsed = JSON.parse(jsonStr) as Partial<SteeringDecision>;
    const action = parsed.action;
    if (action !== "continue" && action !== "steer" && action !== "done") {
      return safeContinue("Invalid action in supervisor response");
    }
    return {
      action,
      message: typeof parsed.message === "string" ? parsed.message.trim() : undefined,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    };
  } catch {
    return safeContinue("Failed to parse supervisor JSON decision");
  }
}

function safeContinue(reason: string): SteeringDecision {
  return { action: "continue", reasoning: reason, confidence: 0 };
}
