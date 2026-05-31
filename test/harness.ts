/**
 * Test harness — in-memory fakes for the pi ExtensionAPI / ExtensionContext,
 * enough to load the real extension (src/index.ts) and drive it through its
 * public surface: registered commands, the start_supervision tool, and the
 * lifecycle events (session_start, turn_end, agent_end).
 *
 * The only external seam stubbed is the LLM call (src/model-client.js), mocked
 * per-test via vi.mock so the real engine.analyze logic still runs.
 */

import type { SupervisorState } from "../src/types.js";

export interface RecordedMessage {
  text: string;
  options?: Record<string, unknown>;
}

export interface MockPi {
  // recorded registrations
  handlers: Map<string, Array<(event: any, ctx: any) => any>>;
  commands: Map<string, { description: string; handler: (args: string, ctx: any) => Promise<void> }>;
  tools: Array<Record<string, any>>;
  entries: Array<{ type: string; data: any }>;
  sentMessages: RecordedMessage[];
  // the ExtensionAPI passed to the extension
  api: any;
  // drivers
  fire(event: string, evt: any, ctx: any): Promise<void>;
  command(name: string): { handler: (args: string, ctx: any) => Promise<void> };
  tool(name: string): Record<string, any>;
}

export function createMockPi(): MockPi {
  const handlers = new Map<string, Array<(event: any, ctx: any) => any>>();
  const commands = new Map<string, any>();
  const tools: Array<Record<string, any>> = [];
  const entries: Array<{ type: string; data: any }> = [];
  const sentMessages: RecordedMessage[] = [];

  const api = {
    on(event: string, handler: (event: any, ctx: any) => any) {
      const arr = handlers.get(event) ?? [];
      arr.push(handler);
      handlers.set(event, arr);
    },
    registerCommand(name: string, def: any) {
      commands.set(name, def);
    },
    registerTool(tool: Record<string, any>) {
      tools.push(tool);
    },
    appendEntry(type: string, data: any) {
      // Mirror pi: persisted entries become part of the session branch as
      // { type: "custom", customType, data }. The mock ctx reads from its own
      // branch array, so tests that care wire the two together explicitly.
      entries.push({ type, data });
    },
    sendUserMessage(text: string, options?: Record<string, unknown>) {
      sentMessages.push({ text, options });
    },
  };

  return {
    handlers,
    commands,
    tools,
    entries,
    sentMessages,
    api,
    async fire(event, evt, ctx) {
      for (const h of handlers.get(event) ?? []) await h(evt, ctx);
    },
    command: (name) => commands.get(name),
    tool: (name) => tools.find((t) => t.name === name) as Record<string, any>,
  };
}

export interface MockCtx {
  ctx: any;
  status: Map<string, unknown>;
  widgets: Map<string, unknown>;
  notifications: Array<{ message: string; level: string }>;
  branch: any[];
}

export interface MockCtxOptions {
  cwd?: string;
  branch?: any[];
  /** Model the active chat session reports (ctx.model). */
  sessionModel?: { provider: string; id: string };
  /** Providers for which an API key is "available". Default: all. */
  apiKeyProviders?: string[] | "all";
  /** Models the registry can resolve via find(provider, id). */
  knownModels?: Array<{ provider: string; id: string }>;
}

export function createMockCtx(opts: MockCtxOptions = {}): MockCtx {
  const status = new Map<string, unknown>();
  const widgets = new Map<string, unknown>();
  const notifications: Array<{ message: string; level: string }> = [];
  const branch = opts.branch ?? [];

  const ctx = {
    cwd: opts.cwd ?? "/tmp/pi-supervisor-nonexistent",
    model: opts.sessionModel,
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      setStatus(id: string, value: unknown) {
        if (value === undefined) status.delete(id);
        else status.set(id, value);
      },
      setWidget(id: string, value: unknown) {
        if (value === undefined) widgets.delete(id);
        else widgets.set(id, value);
      },
    },
    sessionManager: {
      getBranch: () => branch,
    },
    modelRegistry: {
      async getApiKeyForProvider(provider: string) {
        if (opts.apiKeyProviders === undefined || opts.apiKeyProviders === "all") return "key";
        return opts.apiKeyProviders.includes(provider) ? "key" : undefined;
      },
      find(provider: string, id: string) {
        const known = opts.knownModels ?? [];
        return known.find((m) => m.provider === provider && m.id === id) ?? { provider, id };
      },
    },
  };

  return { ctx, status, widgets, notifications, branch };
}

/** A session-branch entry mimicking a persisted supervisor-state record. */
export function supervisorStateEntry(state: Partial<SupervisorState>): any {
  return {
    type: "custom",
    customType: "supervisor-state",
    data: {
      active: true,
      outcome: "goal",
      provider: "anthropic",
      modelId: "claude-haiku-4-5-20251001",
      sensitivity: "medium",
      interventions: [],
      startedAt: 0,
      turnCount: 0,
      ...state,
    },
  };
}
