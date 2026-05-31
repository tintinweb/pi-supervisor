/**
 * End-to-end tests for the pi-supervisor extension (src/index.ts).
 *
 * These load the REAL extension into a fake pi runtime and drive it the way pi
 * would — registering the /supervise command + start_supervision tool, then
 * firing turn_end / agent_end / session_start events and invoking commands.
 *
 * The only stub is the LLM boundary: src/model-client.ts#callSupervisorModel is
 * mocked, so the real engine.analyze logic (prompt building, snapshot, idle
 * fallback) still runs against a controllable "model" verdict.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { callSupervisorModel } from "../src/model-client.js";
import type { SteeringDecision } from "../src/types.js";
import { createMockCtx, createMockPi, type MockPi, supervisorStateEntry } from "./harness.js";

vi.mock("../src/model-client.js", () => ({ callSupervisorModel: vi.fn() }));
const mockedCall = vi.mocked(callSupervisorModel);

// Load the extension default export lazily (after the mock is registered).
import createExtension from "../src/index.js";

function steer(message: string, confidence = 0.95): SteeringDecision {
  return { action: "steer", message, reasoning: "r", confidence };
}
const DONE: SteeringDecision = { action: "done", reasoning: "achieved", confidence: 1 };
const CONTINUE: SteeringDecision = { action: "continue", reasoning: "fine", confidence: 0.3 };

function setup() {
  const pi = createMockPi();
  createExtension(pi.api);
  return pi;
}

/** Start supervision via the tool (the non-interactive path), returning ctx. */
async function startViaTool(pi: MockPi, outcome = "Ship feature X", extra: Record<string, unknown> = {}) {
  const m = createMockCtx({ apiKeyProviders: "all", sessionModel: { provider: "anthropic", id: "m" } });
  await pi.tool("start_supervision").execute("call-1", { outcome, ...extra }, undefined, undefined, m.ctx);
  return m;
}

beforeEach(() => {
  mockedCall.mockReset();
  mockedCall.mockResolvedValue(CONTINUE);
});

describe("extension wiring", () => {
  it("registers the /supervise command, start_supervision tool, and lifecycle handlers", () => {
    const pi = setup();
    expect(pi.command("supervise")).toBeDefined();
    expect(pi.tool("start_supervision")).toBeDefined();
    for (const ev of ["session_start", "session_tree", "turn_end", "agent_end"]) {
      expect(pi.handlers.get(ev)?.length).toBeGreaterThan(0);
    }
  });
});

describe("start_supervision tool", () => {
  it("activates supervision and shows the 🎯 status badge", async () => {
    const pi = setup();
    const m = await startViaTool(pi, "Implement auth");

    expect(m.status.get("supervisor")).toBe("🎯");
    expect(m.notifications.at(-1)?.message).toMatch(/Supervisor started by agent/);
    // state persisted to the session
    expect(pi.entries.some((e) => e.type === "supervisor-state" && e.data.active)).toBe(true);
  });

  it("parses 'provider/modelId' and a bare modelId (defaults provider)", async () => {
    const pi = setup();
    await startViaTool(pi, "g", { model: "openai/gpt-x" });
    const last = pi.entries.at(-1)!.data;
    expect(last.provider).toBe("openai");
    expect(last.modelId).toBe("gpt-x");

    const pi2 = setup();
    await startViaTool(pi2, "g", { model: "bare-model" });
    const last2 = pi2.entries.at(-1)!.data;
    expect(last2.provider).toBe("anthropic"); // DEFAULT_PROVIDER
    expect(last2.modelId).toBe("bare-model");
  });

  it("is locked once active — the model cannot change the outcome", async () => {
    const pi = setup();
    const m = createMockCtx({ apiKeyProviders: "all" });
    await pi.tool("start_supervision").execute("c1", { outcome: "FIRST" }, undefined, undefined, m.ctx);

    const res = await pi.tool("start_supervision").execute("c2", { outcome: "SECOND" }, undefined, undefined, m.ctx);
    const text = res.content[0].text;
    expect(text).toMatch(/already active/i);
    expect(text).toContain("FIRST"); // still the original outcome
    // No new active-state entry with the second outcome was written
    expect(pi.entries.every((e) => e.data.outcome !== "SECOND")).toBe(true);
  });
});

describe("agent_end — the idle steering checkpoint", () => {
  it("does nothing when supervision is inactive", async () => {
    const pi = setup();
    const m = createMockCtx();
    await pi.fire("agent_end", {}, m.ctx);
    expect(mockedCall).not.toHaveBeenCalled();
    expect(pi.sentMessages).toHaveLength(0);
  });

  it("steers: sends the message as a user turn and records the intervention", async () => {
    const pi = setup();
    const m = await startViaTool(pi);
    mockedCall.mockResolvedValue(steer("Add the missing tests."));

    await pi.fire("agent_end", {}, m.ctx);

    expect(pi.sentMessages).toEqual([{ text: "Add the missing tests.", options: undefined }]);
    const persisted = pi.entries.at(-1)!.data;
    expect(persisted.interventions).toHaveLength(1);
    expect(persisted.interventions[0].message).toBe("Add the missing tests.");
    expect(persisted.turnCount).toBe(1);
  });

  it("done: notifies, stops supervision, and clears the status badge", async () => {
    const pi = setup();
    const m = await startViaTool(pi, "Build it");
    mockedCall.mockResolvedValue(DONE);

    await pi.fire("agent_end", {}, m.ctx);

    expect(m.notifications.at(-1)?.message).toMatch(/outcome achieved.*Build it/);
    expect(m.status.has("supervisor")).toBe(false); // cleared on stop
    expect(pi.sentMessages).toHaveLength(0); // a done verdict never steers
  });

  it("falls back to a steer when the model call fails while idle", async () => {
    // engine.analyze catches the rejection and, because the agent is idle,
    // returns a safety steer rather than letting the agent sit stuck.
    const pi = setup();
    const m = await startViaTool(pi);
    mockedCall.mockRejectedValue(new Error("network"));

    await pi.fire("agent_end", {}, m.ctx);

    expect(pi.sentMessages).toHaveLength(1);
    expect(pi.sentMessages[0].text).toMatch(/continue working toward the goal/i);
  });

  it("after 5 steers, the 6th evaluation runs in lenient stagnation mode", async () => {
    const pi = setup();
    const m = await startViaTool(pi);
    mockedCall.mockResolvedValue(steer("keep going"));

    for (let i = 0; i < 5; i++) await pi.fire("agent_end", {}, m.ctx);
    // The first 5 calls were NOT stagnating (idleSteers 0→4 at call time).
    for (let i = 0; i < 5; i++) {
      expect(mockedCall.mock.calls[i][4]).not.toMatch(/STAGNATION/);
    }
    // 6th: idleSteers is now 5 → stagnation warning injected into the prompt.
    await pi.fire("agent_end", {}, m.ctx);
    expect(mockedCall.mock.calls[5][4]).toMatch(/STAGNATION/);

    // And if that lenient pass returns done, the notice says why it stopped.
    mockedCall.mockResolvedValue(DONE);
    await pi.fire("agent_end", {}, m.ctx);
    expect(m.notifications.at(-1)?.message).toMatch(/stopped after 5 steering attempts/);
  });
});

describe("turn_end — mid-turn steering by sensitivity", () => {
  async function startWith(sensitivity: string) {
    const pi = setup();
    const m = await startViaTool(pi, "goal", { sensitivity });
    return { pi, m };
  }

  it("low sensitivity never checks mid-turn", async () => {
    const { pi, m } = await startWith("low");
    mockedCall.mockResolvedValue(steer("x"));
    for (const turnIndex of [2, 3, 5, 8]) await pi.fire("turn_end", { turnIndex }, m.ctx);
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it("skips the first two turns regardless of sensitivity", async () => {
    const { pi, m } = await startWith("high");
    mockedCall.mockResolvedValue(steer("x"));
    await pi.fire("turn_end", { turnIndex: 0 }, m.ctx);
    await pi.fire("turn_end", { turnIndex: 1 }, m.ctx);
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it("medium checks turns 2, 5, 8 (every 3rd) and steers only at confidence ≥ 0.9", async () => {
    const { pi, m } = await startWith("medium");
    mockedCall.mockResolvedValue(steer("nudge", 0.95));

    for (const turnIndex of [2, 3, 4, 5]) await pi.fire("turn_end", { turnIndex }, m.ctx);
    // checked only at 2 and 5
    expect(mockedCall).toHaveBeenCalledTimes(2);
    // both above threshold → two steers, delivered with deliverAs:"steer"
    expect(pi.sentMessages).toHaveLength(2);
    expect(pi.sentMessages[0]).toEqual({ text: "nudge", options: { deliverAs: "steer" } });
  });

  it("medium does NOT steer when confidence is below 0.9", async () => {
    const { pi, m } = await startWith("medium");
    mockedCall.mockResolvedValue(steer("nudge", 0.89));
    await pi.fire("turn_end", { turnIndex: 2 }, m.ctx);
    expect(mockedCall).toHaveBeenCalledTimes(1); // it checked
    expect(pi.sentMessages).toHaveLength(0); // but stayed its hand
  });

  it("high checks every turn from 2 and steers at confidence ≥ 0.85", async () => {
    const { pi, m } = await startWith("high");
    mockedCall.mockResolvedValue(steer("nudge", 0.85));
    for (const turnIndex of [2, 3, 4]) await pi.fire("turn_end", { turnIndex }, m.ctx);
    expect(mockedCall).toHaveBeenCalledTimes(3);
    expect(pi.sentMessages).toHaveLength(3);
  });
});

describe("/supervise command — non-interactive subcommands", () => {
  it("stop warns when inactive and stops when active", async () => {
    const pi = setup();
    const inactive = createMockCtx();
    await pi.command("supervise").handler("stop", inactive.ctx);
    expect(inactive.notifications.at(-1)?.message).toMatch(/not active/i);

    const m = await startViaTool(pi);
    await pi.command("supervise").handler("stop", m.ctx);
    expect(m.notifications.at(-1)?.message).toMatch(/stopped/i);
    expect(m.status.has("supervisor")).toBe(false);
  });

  it("sensitivity rejects an invalid level and accepts a valid one", async () => {
    const pi = setup();
    const m = await startViaTool(pi);

    await pi.command("supervise").handler("sensitivity sideways", m.ctx);
    expect(m.notifications.at(-1)?.message).toMatch(/Usage:/);

    await pi.command("supervise").handler("sensitivity high", m.ctx);
    expect(m.notifications.at(-1)?.message).toMatch(/sensitivity set to "high"/);
    expect(pi.entries.at(-1)!.data.sensitivity).toBe("high");
  });

  it("model <provider/modelId> updates the active supervisor model", async () => {
    const pi = setup();
    const m = await startViaTool(pi);
    await pi.command("supervise").handler("model openai/gpt-9", m.ctx);
    const last = pi.entries.at(-1)!.data;
    expect(last.provider).toBe("openai");
    expect(last.modelId).toBe("gpt-9");
  });
});

describe("session restore", () => {
  it("restores active supervision from a persisted entry on session_start", async () => {
    const pi = setup();
    const m = createMockCtx({ branch: [supervisorStateEntry({ outcome: "restored goal" })] });

    await pi.fire("session_start", {}, m.ctx);

    expect(m.status.get("supervisor")).toBe("🎯"); // active → badge shown
    // and the restored state drives a subsequent agent_end without a fresh start
    mockedCall.mockResolvedValue(DONE);
    await pi.fire("agent_end", {}, m.ctx);
    expect(m.notifications.at(-1)?.message).toMatch(/restored goal/);
  });

  it("leaves the badge cleared when the persisted state is inactive", async () => {
    const pi = setup();
    const m = createMockCtx({ branch: [supervisorStateEntry({ active: false })] });
    await pi.fire("session_start", {}, m.ctx);
    expect(m.status.has("supervisor")).toBe(false);
  });
});
