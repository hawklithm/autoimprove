import { describe, expect, it } from "vitest";
import { isContextContinuationMessage } from "../src/core/session-analyzer.js";

describe("session continuation filtering", () => {
  it("recognizes context-window continuation summaries as non-user corrections", () => {
    expect(isContextContinuationMessage(
      "This session is being continued from a previous conversation that ran out of context."
    )).toBe(true);
    expect(isContextContinuationMessage(
      "Summary below covers the earlier portion of the conversation."
    )).toBe(true);
  });

  it("keeps real correction text", () => {
    expect(isContextContinuationMessage(
      "Please change the callback validation to reject expired tokens."
    )).toBe(false);
  });
});
