/**
 * model-client — calls the supervisor LLM using pi's internal agent session API.
 *
 * Creates an ephemeral in-memory AgentSession with no tools and a custom system
 * prompt, sends the analysis request, collects the text response, and disposes
 * the session. This reuses pi's auth, model registry, and retry infrastructure
 * rather than making raw HTTP calls.
 */

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SteeringDecision } from "./types.js";

/**
 * Run a one-shot supervisor analysis using pi's internal agent session.
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
  // Resolve the model via the shared registry (same auth / API keys as main session)
  const model = ctx.modelRegistry.find(provider, modelId);
  if (!model) {
    return safeContinue(`Model not found in registry: ${provider}/${modelId}`);
  }

  // Build a minimal resource loader: no extensions, no skills, custom system prompt
  const loader = new DefaultResourceLoader({
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPromptOverride: () => systemPrompt,
  });
  await loader.reload();

  let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  try {
    const result = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      modelRegistry: ctx.modelRegistry,
      model,
      tools: [],          // supervisor only needs text generation
      resourceLoader: loader,
    });
    session = result.session;
  } catch (err) {
    return safeContinue(`Failed to create supervisor session: ${String(err)}`);
  }

  // Wire abort signal → session abort
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
  } catch (err) {
    return safeContinue(`Supervisor prompt failed: ${String(err)}`);
  } finally {
    unsubscribe();
    signal?.removeEventListener("abort", onAbort);
    session.dispose();
  }

  return parseDecision(responseText);
}

// ---- Response parsing ----

function parseDecision(text: string): SteeringDecision {
  // Model may wrap JSON in markdown fences — strip them
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
