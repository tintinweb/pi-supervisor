/**
 * SupervisorStateManager — manages in-memory supervisor state and session persistence.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SupervisorState, SupervisorIntervention, Sensitivity, SupervisorPrefs } from "./types.js";

const ENTRY_TYPE = "supervisor-state";
const PREFS_ENTRY_TYPE = "supervisor-prefs";

export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL_ID = "claude-haiku-4-5-20251001";
export const DEFAULT_SENSITIVITY: Sensitivity = "medium";

export class SupervisorStateManager {
  private state: SupervisorState | null = null;
  private prefs: SupervisorPrefs = {};
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
    this.prefs = { ...this.prefs, provider, modelId, sensitivity };
    this.persistPrefs();
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

  getPrefs(): SupervisorPrefs {
    return this.prefs;
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
    if (this.state) {
      this.state.provider = provider;
      this.state.modelId = modelId;
      this.persist();
    }
    this.prefs = { ...this.prefs, provider, modelId };
    this.persistPrefs();
  }

  setSensitivity(sensitivity: Sensitivity): void {
    if (this.state) {
      this.state.sensitivity = sensitivity;
      this.persist();
    }
    this.prefs = { ...this.prefs, sensitivity };
    this.persistPrefs();
  }

  /** Restore state from session entries (finds the most recent supervisor-state entry). */
  loadFromSession(ctx: ExtensionContext): void {
    const entries = ctx.sessionManager.getBranch();
    this.state = null;
    this.prefs = {};

    let foundState = false;
    let foundPrefs = false;

    for (let i = entries.length - 1; i >= 0 && (!foundState || !foundPrefs); i--) {
      const entry = entries[i];
      if (entry.type !== "custom") continue;

      if (!foundState && (entry as any).customType === ENTRY_TYPE) {
        this.state = (entry as any).data as SupervisorState;
        foundState = true;
        continue;
      }

      if (!foundPrefs && (entry as any).customType === PREFS_ENTRY_TYPE) {
        this.prefs = ((entry as any).data ?? {}) as SupervisorPrefs;
        foundPrefs = true;
      }
    }

    if (!foundPrefs && this.state) {
      this.prefs = {
        provider: this.state.provider,
        modelId: this.state.modelId,
        sensitivity: this.state.sensitivity,
      };
    }
  }

  private persist(): void {
    if (!this.state) return;
    this.pi.appendEntry(ENTRY_TYPE, { ...this.state });
  }

  private persistPrefs(): void {
    this.pi.appendEntry(PREFS_ENTRY_TYPE, { ...this.prefs });
  }
}
