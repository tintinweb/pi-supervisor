/**
 * SupervisorStateManager — manages in-memory supervisor state and session persistence.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SupervisorState, SupervisorIntervention, Sensitivity } from "./types.js";

const ENTRY_TYPE = "supervisor-state";

export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL_ID = "claude-haiku-4-5-20251001";
export const DEFAULT_SENSITIVITY: Sensitivity = "medium";

export class SupervisorStateManager {
  private state: SupervisorState | null = null;
  private pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  start(outcome: string, provider: string, modelId: string, sensitivity: Sensitivity): void {
    this.state = {
      active: true,
      outcome,
      provider,
      modelId,
      sensitivity,
      interventions: [],
      startedAt: Date.now(),
      turnCount: 0,
    };
    this.persist();
  }

  stop(): void {
    if (!this.state) return;
    this.state.active = false;
    this.persist();
  }

  isActive(): boolean {
    return this.state?.active === true;
  }

  getState(): SupervisorState | null {
    return this.state;
  }

  addIntervention(intervention: SupervisorIntervention): void {
    if (!this.state) return;
    this.state.interventions.push(intervention);
    this.persist();
  }

  incrementTurnCount(): void {
    if (!this.state) return;
    this.state.turnCount++;
  }

  setModel(provider: string, modelId: string): void {
    if (!this.state) return;
    this.state.provider = provider;
    this.state.modelId = modelId;
    this.persist();
  }

  setSensitivity(sensitivity: Sensitivity): void {
    if (!this.state) return;
    this.state.sensitivity = sensitivity;
    this.persist();
  }

  /** Restore state from session entries (finds the most recent supervisor-state entry). */
  loadFromSession(ctx: ExtensionContext): void {
    const entries = ctx.sessionManager.getBranch();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry.type === "custom" && (entry as any).customType === ENTRY_TYPE) {
        this.state = (entry as any).data as SupervisorState;
        return;
      }
    }
    this.state = null;
  }

  private persist(): void {
    if (!this.state) return;
    this.pi.appendEntry(ENTRY_TYPE, { ...this.state });
  }
}
