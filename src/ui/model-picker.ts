/**
 * model-picker — wraps pi's internal ModelSelectorComponent for use in
 * the /supervise model command. Shows the same model selector the user
 * sees when pressing Ctrl+P in pi, with search and API-key availability.
 */

import { ModelSelectorComponent, SettingsManager } from "@mariozechner/pi-coding-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";

/**
 * Open the interactive model picker.
 * Returns the selected Model, or null if the user cancelled.
 */
export async function pickModel(
  ctx: ExtensionContext,
  currentProvider?: string,
  currentModelId?: string
): Promise<Model<any> | null> {
  // Resolve the currently-selected supervisor model (to pre-highlight it)
  const currentModel =
    currentProvider && currentModelId
      ? ctx.modelRegistry.find(currentProvider, currentModelId)
      : undefined;

  // Minimal in-memory settings — we only need the selector, not persistence
  const settingsManager = SettingsManager.inMemory();

  return ctx.ui.custom<Model<any> | null>((tui, _theme, _kb, done) => {
    const component = new ModelSelectorComponent(
      tui,
      currentModel,
      settingsManager,
      ctx.modelRegistry,
      [], // no scoped-model cycling — we want the full model list
      (model) => done(model),
      () => done(null)
    );

    // Give focus so the search input is active immediately
    component.focused = true;

    return {
      render: (width) => component.render(width),
      invalidate: () => component.invalidate(),
      handleInput: (data) => {
        component.handleInput(data);
        tui.requestRender();
      },
    };
  });
}
