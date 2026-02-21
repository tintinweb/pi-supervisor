/**
 * pi-supervisor — A pi extension that supervises the chat and steers it toward a defined outcome.
 *
 * Commands:
 *   /supervise <outcome>          — start supervising
 *   /supervise stop               — stop supervision
 *   /supervise status             — show current status widget
 *   /supervise model              — open interactive model picker (pi-style)
 *   /supervise model <p/modelId>  — set model directly (scripting)
 *   /supervise sensitivity <low|medium|high> — adjust steering sensitivity
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { SupervisorStateManager, DEFAULT_PROVIDER, DEFAULT_MODEL_ID, DEFAULT_SENSITIVITY } from "./state.js";
import { analyze, loadSystemPrompt } from "./engine.js";
import { updateUI, toggleWidget, isWidgetVisible, type WidgetAction } from "./ui/status-widget.js";
import { pickModel } from "./ui/model-picker.js";
import { loadWorkspaceModel, saveWorkspaceModel } from "./workspace-config.js";
import type { Sensitivity } from "./types.js";
import { Type } from "@sinclair/typebox";

/**
 * Extract partial reasoning text from the supervisor's streaming JSON response.
 * Works on incomplete JSON while the model is still generating.
 */
function extractThinking(accumulated: string): string {
  // Find the "reasoning" key and capture content after the opening quote
  const keyIdx = accumulated.indexOf('"reasoning"');
  if (keyIdx === -1) return "";
  const after = accumulated.slice(keyIdx + '"reasoning"'.length);
  const openMatch = after.match(/^\s*:\s*"/);
  if (!openMatch) return "";
  const content = after.slice(openMatch[0].length);
  // If the closing quote has arrived, take only what's inside; otherwise take all (streaming)
  const closeIdx = content.search(/(?<!\\)"/);
  const raw = closeIdx === -1 ? content : content.slice(0, closeIdx);
  return raw.replace(/\\n/g, " ").replace(/\\"/g, '"').trim();
}

// After this many consecutive idle-state steers with no "done", run a lenient final evaluation.
const MAX_IDLE_STEERS = 5;

export default function (pi: ExtensionAPI) {
  const state = new SupervisorStateManager(pi);
  let currentCtx: ExtensionContext | undefined;
  let idleSteers = 0; // consecutive agent_end steers; reset on done/stop/new supervision

  // ---- Session lifecycle: restore state ----

  const onSessionLoad = (ctx: ExtensionContext) => {
    currentCtx = ctx;
    state.loadFromSession(ctx);
    updateUI(ctx, state.getState());
  };

  pi.on("session_start", async (_event, ctx) => onSessionLoad(ctx));
  pi.on("session_switch", async (_event, ctx) => onSessionLoad(ctx));
  pi.on("session_fork", async (_event, ctx) => onSessionLoad(ctx));
  pi.on("session_tree", async (_event, ctx) => onSessionLoad(ctx));

  // ---- Keep ctx fresh ----

  pi.on("turn_start", async (_event, ctx) => {
    currentCtx = ctx;
  });

  // ---- Mid-turn steering: high sensitivity only ----
  // turn_end fires after each LLM sub-turn (tool-call cycle) while the agent is still running.
  // We use deliverAs:"steer" to inject a correction mid-run when the agent is clearly off track.
  // Only fires on high sensitivity; requires high confidence to avoid disrupting productive work.

  pi.on("turn_end", async (event, ctx) => {
    currentCtx = ctx;
    if (!state.isActive()) return;
    const s = state.getState()!;

    // Mid-turn analysis only on high sensitivity, and only after the agent has made some progress
    if (s.sensitivity !== "high") return;
    if (event.turnIndex < 2) return; // give the agent a couple of turns to settle

    let decision;
    try {
      decision = await analyze(ctx, s, false /* agent still working */, false /* can't stagnate mid-turn */);
    } catch {
      return;
    }

    // Only interrupt if very confident — mid-turn steering is disruptive
    if (decision.action === "steer" && decision.message && decision.confidence >= 0.85) {
      state.addIntervention({
        turnCount: s.turnCount,
        message: decision.message,
        reasoning: decision.reasoning,
        timestamp: Date.now(),
      });
      updateUI(ctx, state.getState(), { type: "steering", message: decision.message });
      pi.sendUserMessage(decision.message, { deliverAs: "steer" });
    }
  });

  // ---- Inject supervisor reminder into system prompt each turn ----

  pi.on("before_agent_start", async (event, _ctx) => {
    if (!state.isActive()) return;
    const s = state.getState()!;
    const reminder =
      `\n\n[SUPERVISOR ACTIVE — Stay on track]\nDesired outcome: ${s.outcome}\n` +
      `Sensitivity: ${s.sensitivity}. Focus on the outcome above.`;
    return { systemPrompt: event.systemPrompt + reminder };
  });

  // ---- After each agent response: analyze + steer ----

  pi.on("agent_end", async (_event, ctx) => {
    currentCtx = ctx;
    if (!state.isActive()) return;

    state.incrementTurnCount();
    const s = state.getState()!;

    // After agent_end the agent is idle and waiting for input — this is the critical moment
    const agentIsIdle = ctx.isIdle();

    // Stagnation: too many idle steers with no "done" → final lenient evaluation
    const stagnating = agentIsIdle && idleSteers >= MAX_IDLE_STEERS;

    updateUI(ctx, s, { type: "analyzing", turn: s.turnCount });

    const decision = await analyze(ctx, s, agentIsIdle, stagnating, undefined, (accumulated) => {
      const thinking = extractThinking(accumulated);
      updateUI(ctx, state.getState()!, { type: "analyzing", turn: s.turnCount, thinking });
    });

    if (decision.action === "steer" && decision.message) {
      if (agentIsIdle) idleSteers++;
      state.addIntervention({
        turnCount: s.turnCount,
        message: decision.message,
        reasoning: decision.reasoning,
        timestamp: Date.now(),
      });
      updateUI(ctx, state.getState(), { type: "steering", message: decision.message });
      // agent_end fires when the agent is already idle — plain sendUserMessage triggers a new turn immediately
      pi.sendUserMessage(decision.message);
    } else if (decision.action === "done") {
      idleSteers = 0;
      updateUI(ctx, state.getState(), { type: "done" });
      const suffix = stagnating ? ` (stopped after ${MAX_IDLE_STEERS} steering attempts — goal substantially achieved)` : "";
      ctx.ui.notify(`Supervisor: outcome achieved! "${s.outcome}"${suffix}`, "info");
      state.stop();
      updateUI(ctx, state.getState());
    } else {
      updateUI(ctx, state.getState(), { type: "watching" });
    }
  });

  // ---- /supervise command ----

  pi.registerCommand("supervise", {
    description: "Supervise the chat toward a desired outcome (/supervise <outcome>)",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const trimmed = args?.trim() ?? "";

      // --- subcommands ---

      if (trimmed === "widget") {
        const visible = toggleWidget();
        if (state.isActive()) {
          updateUI(ctx, state.getState());
        }
        ctx.ui.notify(`Supervisor widget ${visible ? "shown" : "hidden"}.`, "info");
        return;
      }

      if (trimmed === "stop") {
        if (!state.isActive()) {
          ctx.ui.notify("Supervisor is not active.", "warning");
          return;
        }
        state.stop();
        idleSteers = 0;
        updateUI(ctx, state.getState());
        ctx.ui.notify("Supervisor stopped.", "info");
        return;
      }

      if (trimmed === "status") {
        const s = state.getState();
        if (!s) {
          ctx.ui.notify("No active supervision. Use /supervise <outcome> to start.", "info");
          return;
        }
        updateUI(ctx, s);
        const { source } = loadSystemPrompt(ctx.cwd);
        const promptLabel = source === "built-in" ? "built-in prompt" : source.replace(ctx.cwd, ".");
        ctx.ui.notify(
          s.active
            ? `Supervising: "${s.outcome}" | ${s.interventions.length} steers | ${promptLabel}`
            : `Supervision stopped. Last outcome: "${s.outcome}"`,
          s.active ? "info" : "warning"
        );
        return;
      }

      if (trimmed === "model" || trimmed.startsWith("model ")) {
        const spec = trimmed.slice(5).trim(); // "" when no args

        if (!spec) {
          // No args → open the interactive pi-style model picker
          const s = state.getState();
          const picked = await pickModel(ctx, s?.provider, s?.modelId);
          if (!picked) return; // user cancelled

          const provider = picked.provider;
          const modelId = picked.id;

          if (state.isActive()) {
            state.setModel(provider, modelId);
            updateUI(ctx, state.getState());
          }
          const saved = saveWorkspaceModel(ctx.cwd, provider, modelId);
          ctx.ui.notify(
            `Supervisor model set to ${provider}/${modelId}${state.isActive() ? "" : " (takes effect on next /supervise)"}` +
              (saved ? " · saved to .pi/" : ""),
            "info"
          );
          return;
        }

        // Args provided → direct assignment (for scripting)
        const slashIdx = spec.indexOf("/");
        let provider: string;
        let modelId: string;
        if (slashIdx === -1) {
          provider = state.getState()?.provider ?? DEFAULT_PROVIDER;
          modelId = spec;
        } else {
          provider = spec.slice(0, slashIdx);
          modelId = spec.slice(slashIdx + 1);
        }

        if (state.isActive()) {
          state.setModel(provider, modelId);
          updateUI(ctx, state.getState());
        }
        const saved = saveWorkspaceModel(ctx.cwd, provider, modelId);
        ctx.ui.notify(
          `Supervisor model set to ${provider}/${modelId}${state.isActive() ? "" : " (takes effect on next /supervise)"}` +
            (saved ? " · saved to .pi/" : ""),
          "info"
        );
        return;
      }

      if (trimmed.startsWith("sensitivity ")) {
        const level = trimmed.slice(12).trim() as Sensitivity;
        if (level !== "low" && level !== "medium" && level !== "high") {
          ctx.ui.notify("Usage: /supervise sensitivity <low|medium|high>", "warning");
          return;
        }
        if (!state.isActive()) {
          ctx.ui.notify(`Sensitivity will be set to "${level}" on next /supervise.`, "info");
        } else {
          state.setSensitivity(level);
          updateUI(ctx, state.getState());
          ctx.ui.notify(`Supervisor sensitivity set to "${level}"`, "info");
        }
        return;
      }

      // --- start supervision ---

      if (!trimmed) {
        const s = state.getState();
        const currentModel = s ? `${s.provider}/${s.modelId}` : `${DEFAULT_PROVIDER}/${DEFAULT_MODEL_ID}`;
        const currentSensitivity = s?.sensitivity ?? DEFAULT_SENSITIVITY;
        const lines = [
          "Usage:  /supervise <desired outcome>",
          "",
          "  /supervise Implement JWT auth with refresh tokens and tests",
          "  /supervise Refactor the payment module — no breaking changes",
          "",
          "Subcommands:",
          "  /supervise stop                      Stop active supervision",
          "  /supervise status                    Show current state and widget",
          "  /supervise widget                    Toggle widget visibility",
          "  /supervise model                     Pick supervisor model (interactive)",
          "  /supervise model <provider/modelId>  Set model directly",
          "  /supervise sensitivity <low|medium|high>  Steer aggressiveness",
          "",
          `Current model:       ${currentModel}`,
          `Current sensitivity: ${currentSensitivity}`,
          `Widget:              ${isWidgetVisible() ? "visible" : "hidden"}`,
          s?.active ? `Active outcome:      "${s.outcome}"` : "Not supervising",
        ].join("\n");
        ctx.ui.notify(lines, "info");
        return;
      }

      // Resolve model settings: session state → workspace config → active session model → built-in defaults
      const existing = state.getState();
      const workspaceModel = loadWorkspaceModel(ctx.cwd);
      const sessionModel = ctx.model;
      let provider = existing?.provider ?? workspaceModel?.provider ?? sessionModel?.provider ?? DEFAULT_PROVIDER;
      let modelId  = existing?.modelId  ?? workspaceModel?.modelId  ?? sessionModel?.id      ?? DEFAULT_MODEL_ID;
      const sensitivity = existing?.sensitivity ?? DEFAULT_SENSITIVITY;

      // Only prompt for a model if none has been configured yet
      if (!existing) {
        const apiKey = await ctx.modelRegistry.getApiKeyForProvider(provider);
        if (!apiKey) {
          ctx.ui.notify(`No API key for "${provider}/${modelId}" — pick a model with an available key.`, "warning");
          const picked = await pickModel(ctx, provider, modelId);
          if (!picked) return; // user cancelled
          provider = picked.provider;
          modelId = picked.id;
        }
      }

      state.start(trimmed, provider, modelId, sensitivity);
      idleSteers = 0;
      updateUI(ctx, state.getState());

      const { source } = loadSystemPrompt(ctx.cwd);
      const promptLabel = source === "built-in" ? "built-in prompt" : source.replace(ctx.cwd, ".");
      ctx.ui.notify(
        `Supervisor active: "${trimmed.slice(0, 50)}${trimmed.length > 50 ? "…" : ""}" | ${provider}/${modelId} | ${promptLabel}`,
        "info"
      );

      // If the agent is idle, send the task as a prompt to kick it off immediately
      if (ctx.isIdle()) {
        pi.sendUserMessage(trimmed);
      }
    },
  });

  // ---- Tool: model can initiate supervision but never modify an active session ----

  pi.registerTool({
    name: "start_supervision",
    label: "Start Supervision",
    description:
      "Activate the supervisor to track the conversation toward a specific outcome. " +
      "The supervisor will observe every turn and steer the agent if it drifts. " +
      "Once supervision is active it is locked — only the user can change or stop it.",
    parameters: Type.Object({
      outcome: Type.String({
        description:
          "The desired end-state to supervise toward. Be specific and measurable " +
          "(e.g. 'Implement JWT auth with refresh tokens and full test coverage').",
      }),
    }),
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const text = (msg: string) => ({ content: [{ type: "text" as const, text: msg }], details: undefined });

      // Guard: supervision already active — model cannot modify it
      if (state.isActive()) {
        const s = state.getState()!;
        return text(
          `Supervision is already active and cannot be changed by the model.\n` +
          `Active outcome: "${s.outcome}"\n` +
          `Only the user can stop or modify supervision via /supervise.`
        );
      }

      // Resolve model: workspace config → active session model → built-in default
      const workspaceModel = loadWorkspaceModel(ctx.cwd);
      const sessionModel   = ctx.model;
      const provider = workspaceModel?.provider ?? sessionModel?.provider ?? DEFAULT_PROVIDER;
      const modelId  = workspaceModel?.modelId  ?? sessionModel?.id      ?? DEFAULT_MODEL_ID;

      state.start(params.outcome, provider, modelId, DEFAULT_SENSITIVITY);
      currentCtx = ctx;
      updateUI(ctx, state.getState());

      const { source } = loadSystemPrompt(ctx.cwd);
      const promptLabel = source === "built-in" ? "built-in prompt" : ".pi/SUPERVISOR.md";

      // Notify the user so they're aware supervision was initiated by the model
      ctx.ui.notify(
        `Supervisor started by agent: "${params.outcome.slice(0, 60)}${params.outcome.length > 60 ? "…" : ""}" | ${provider}/${modelId} | ${promptLabel}`,
        "info"
      );

      return text(`Supervision active. Outcome: "${params.outcome}" | ${provider}/${modelId}`);
    },
  });
}
