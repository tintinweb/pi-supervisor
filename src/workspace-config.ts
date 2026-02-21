/**
 * Workspace-level supervisor config — persists model selection to .pi/supervisor-config.json.
 * Only written when the .pi/ directory already exists.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PI_DIR = ".pi";
const CONFIG_FILE = "supervisor-config.json";

export interface WorkspaceModelConfig {
  provider: string;
  modelId: string;
}

/** Read model config from <cwd>/.pi/supervisor-config.json. Returns null if absent or unreadable. */
export function loadWorkspaceModel(cwd: string): WorkspaceModelConfig | null {
  const configPath = join(cwd, PI_DIR, CONFIG_FILE);
  if (!existsSync(configPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
    if (typeof parsed.provider === "string" && typeof parsed.modelId === "string") {
      return { provider: parsed.provider, modelId: parsed.modelId };
    }
  } catch {}
  return null;
}

/**
 * Write model config to <cwd>/.pi/supervisor-config.json.
 * Silently skips if the .pi/ directory does not exist.
 * Returns true when the file was written.
 */
export function saveWorkspaceModel(cwd: string, provider: string, modelId: string): boolean {
  const piDir = join(cwd, PI_DIR);
  if (!existsSync(piDir)) return false;
  try {
    writeFileSync(
      join(piDir, CONFIG_FILE),
      JSON.stringify({ provider, modelId }, null, 2) + "\n",
      "utf-8"
    );
    return true;
  } catch {
    return false;
  }
}
