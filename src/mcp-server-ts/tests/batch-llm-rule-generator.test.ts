/**
 * Tests for BatchLLMRuleGenerator.parseBatchResponse
 * Focuses on lenient recovery of malformed-but-recoverable LLM JSON.
 */

import { describe, it, expect } from "vitest";
import { BatchLLMRuleGenerator } from "../src/core/batch-llm-rule-generator.js";
import type { PatternClusterGroup } from "../src/core/pattern-similarity-clusterer.js";

function makeCluster(): PatternClusterGroup {
  return {
    cluster_id: "test-cluster",
    patterns: [
      {
        type: "anti-pattern",
        description: "Reproduced defect cluster",
        confidence: 0.9,
        frequency: 2,
        first_seen: "2024-01-01",
        last_seen: "2024-01-02",
        occurrences: 2,
        contexts: [],
      } as any,
    ],
    common_keywords: ["json", "parsing"],
    pattern_type: "anti-pattern",
    avg_confidence: 0.9,
    total_occurrences: 2,
    representative_description: "Reproduced defect cluster",
    session_count: 1,
  };
}

describe("BatchLLMRuleGenerator.parseBatchResponse", () => {
  it("should salvage a rule from JSON with an unterminated key (missing quote + colon)", () => {
    // Real-world LLM defect from logs: "rationale "Incomplete...
    const broken = `[
  {
    "title": "Generate complete, self-contained AutoImprove rules with all required fields",
    "description": "Include all mandatory fields.",
    "rationale "Incomplete rules force users to manually add missing fields, wasting time.",
    "scope": "global",
    "scenes": { "tech": [], "functional": ["error-handling"], "business": [] },
    "how_to_apply": ["Verify the output JSON contains exactly these required fields"],
    "when_to_use": ["When generating rule output from AutoImprove pattern analysis"],
    "exceptions": ["When explicitly instructed to output in a different schema format"],
    "source_patterns": ["AutoImprove Summarize - multiple occurrences"],
    "merged_count": 5
  }
]`;

    const generator = new BatchLLMRuleGenerator();
    const rules = generator.parseBatchResponse(broken, makeCluster());

    expect(rules).toHaveLength(1);
    expect(rules[0].rationale).toContain("Incomplete rules");
    expect(rules[0].title).toContain("self-contained AutoImprove rules");
    expect(rules[0].merged_count).toBe(5);
  });

  it("should still throw for genuinely unrecoverable JSON (not silently drop)", () => {
    const generator = new BatchLLMRuleGenerator();

    expect(() =>
      generator.parseBatchResponse("this is not json at all {{{", makeCluster())
    ).toThrow();
  });
});
