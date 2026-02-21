/**
 * Supervisor UI — footer status indicator and widget.
 *
 * Footer: 🎯 emoji badge.
 * Widget line 1: ◉ Supervising · Goal: "…" · model · steers · action
 * Widget line 2: dim thinking text while analyzing (temporary)
 *
 * Toggle visibility with toggleWidget().
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { SupervisorState } from "../types.js";

const WIDGET_ID = "supervisor";
const STATUS_ID = "supervisor";

const MAX_OUTCOME_DISPLAY = 48;
const MAX_STEER_DISPLAY   = 50;
const MAX_THINKING_DISPLAY = 80;

let _widgetVisible = true;

/** Toggle the widget on/off. Returns the new visibility state. */
export function toggleWidget(): boolean {
  _widgetVisible = !_widgetVisible;
  return _widgetVisible;
}

export function isWidgetVisible(): boolean {
  return _widgetVisible;
}

export type WidgetAction =
  | { type: "watching" }
  | { type: "analyzing"; turn: number; thinking?: string }
  | { type: "steering"; message: string }
  | { type: "done" };

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/**
 * Update footer + widget. Call this every time state or action changes.
 * Clears both when state is null or inactive.
 */
export function updateUI(
  ctx: ExtensionContext,
  state: SupervisorState | null,
  action: WidgetAction = { type: "watching" }
): void {
  if (!state || !state.active) {
    ctx.ui.setStatus(STATUS_ID, undefined);
    ctx.ui.setWidget(WIDGET_ID, undefined);
    return;
  }

  ctx.ui.setStatus(STATUS_ID, "🎯");

  if (!_widgetVisible) {
    ctx.ui.setWidget(WIDGET_ID, undefined);
    return;
  }

  const snap = {
    outcome: state.outcome,
    modelId: state.modelId,
    interventions: [...state.interventions],
  };
  const snapAction = action;

  ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => {
    const steerCount = snap.interventions.length;

    // Header: ◉ Supervising
    const header = `${theme.fg("accent", "◉")} ${theme.fg("accent", "Supervising")}`;
    // Goal label + value
    const goalLabel = theme.fg("dim", "Goal:");
    const goalText  = theme.fg("muted", `"${truncate(snap.outcome, MAX_OUTCOME_DISPLAY)}"`);
    const goal      = `${goalLabel} ${goalText}`;
    // Model
    const model  = theme.fg("dim", snap.modelId);
    // Steer count
    const steers = steerCount > 0 ? theme.fg("dim", `↗ ${steerCount}`) : "";

    // Current action
    let actionStr: string;
    let thinking = "";
    switch (snapAction.type) {
      case "watching":
        actionStr = theme.fg("dim", "watching");
        break;
      case "analyzing":
        actionStr = theme.fg("warning", `⟳ turn ${snapAction.turn}`);
        thinking  = snapAction.thinking ?? "";
        break;
      case "steering":
        actionStr = theme.fg("warning", `↗ "${truncate(snapAction.message, MAX_STEER_DISPLAY)}"`);
        break;
      case "done":
        actionStr = theme.fg("accent", "✓ done");
        break;
    }

    const sep   = theme.fg("dim", " · ");
    const parts = [header, goal, model, steers, actionStr].filter(Boolean);
    const line  = parts.join(sep);

    const thinkingLine = thinking
      ? theme.fg("dim", `  ${truncate(thinking, MAX_THINKING_DISPLAY)}`)
      : "";

    return {
      render: () => thinkingLine ? [line, thinkingLine] : [line],
      invalidate: () => {},
    };
  });
}
