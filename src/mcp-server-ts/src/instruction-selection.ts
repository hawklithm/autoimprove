import {
  SERVER_INSTRUCTIONS_EMPTY,
  SERVER_INSTRUCTIONS_UNIFIED,
  SERVER_INSTRUCTIONS_WARMING_UP,
} from "./mcp-instructions.js";

/** Choose instructions from the persisted index without treating an empty KB as ready. */
export function selectInstructionsForIndex(indexContent?: string): string {
  if (indexContent === undefined) return SERVER_INSTRUCTIONS_EMPTY;

  try {
    const index = JSON.parse(indexContent) as { rules?: unknown[] };
    return Array.isArray(index.rules) && index.rules.length > 0
      ? SERVER_INSTRUCTIONS_UNIFIED
      : SERVER_INSTRUCTIONS_WARMING_UP;
  } catch {
    return SERVER_INSTRUCTIONS_EMPTY;
  }
}
