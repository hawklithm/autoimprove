import { describe, expect, it } from "vitest";
import {
  SERVER_INSTRUCTIONS_EMPTY,
  SERVER_INSTRUCTIONS_UNIFIED,
  SERVER_INSTRUCTIONS_WARMING_UP,
} from "../src/mcp-instructions.js";
import { selectInstructionsForIndex } from "../src/instruction-selection.js";
import {
  SEARCH_KNOWLEDGE_DESCRIPTION,
  emptyKnowledgeBaseMessage,
  noMatchMessage,
} from "../src/search-guidance.js";

describe("trigger optimization", () => {
  it("uses the correct instructions for missing, empty, and populated indexes", () => {
    expect(selectInstructionsForIndex()).toBe(SERVER_INSTRUCTIONS_EMPTY);
    expect(selectInstructionsForIndex('{"rules":[]}')).toBe(SERVER_INSTRUCTIONS_WARMING_UP);
    expect(selectInstructionsForIndex('{"rules":[{"id":"RULE-001"}]}')).toBe(SERVER_INSTRUCTIONS_UNIFIED);
  });

  it("makes search_knowledge a proactive replacement tool", () => {
    expect(SEARCH_KNOWLEDGE_DESCRIPTION).toContain("PRIMARY TOOL — call FIRST");
    expect(SEARCH_KNOWLEDGE_DESCRIPTION).toContain("Instead of guessing patterns");
    expect(SEARCH_KNOWLEDGE_DESCRIPTION).toContain("Following RULE-005");
  });

  it("returns success-shaped guidance for empty and unmatched searches", () => {
    expect(emptyKnowledgeBaseMessage()).toContain("No rules in the knowledge base yet");
    expect(emptyKnowledgeBaseMessage()).not.toContain("Error:");
    expect(noMatchMessage(["RULE-001", "RULE-002"])).toContain("Closest available rules");
    expect(noMatchMessage()).not.toContain("Error:");
  });
});
