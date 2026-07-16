/**
 * Regression test: search_knowledge must filter by keywords (not return all rules)
 *
 * Reproduces the bug where `search_knowledge(keywords=...)` without `scene_json`
 * fell through to list-all and returned every rule in the KB.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RuleScope, RuleIndexEntry, createScene } from "../src/core/models.js";
import { RuleMatcher } from "../src/core/rule-matcher.js";
import { RuleIndexManager } from "../src/storage/rule-index.js";

function makeRule(
  id: string,
  keywords: string[],
  confidence = 0.8
): RuleIndexEntry {
  return {
    id,
    type: "repeated-correction",
    priority: "medium",
    confidence,
    scenes: createScene(),
    scope: RuleScope.GLOBAL,
    scope_context: {},
    keywords,
    created_at: "2024-01-01",
    updated_at: "2024-01-01",
  };
}

describe("Keyword-only search (search_knowledge fix)", () => {
  let indexManager: RuleIndexManager;
  let matcher: RuleMatcher;

  beforeEach(() => {
    process.env.AUTOIMPROVE_STORAGE_ROOT = `/tmp/autoimprove-test-kwsearch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    indexManager = new RuleIndexManager();
    matcher = new RuleMatcher(indexManager);

    // Seed via addRule so keyword_segments index is populated in SQLite
    indexManager.addRule(
      makeRule("rule-cargo", ["cargo", "check", "workspace", "rust"]),
      { id: "rule-cargo", title: "t", description: "d", reason: "r", content: "" }
    );
    indexManager.addRule(
      makeRule("rule-json", ["json", "unterminated", "repair", "parse"]),
      { id: "rule-json", title: "t", description: "d", reason: "r", content: "" }
    );
    indexManager.addRule(
      makeRule("rule-refactor", ["refactor", "class", "interface"]),
      { id: "rule-refactor", title: "t", description: "d", reason: "r", content: "" }
    );
  });

  it("should return only keyword-matching rules, not all rules", () => {
    const matches = matcher.matchRules(
      createScene(),
      ["cargo", "check", "workspace"],
      undefined,
      undefined,
      undefined
    );

    // Must NOT return all 3 rules; should be filtered to cargo-related only
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThan(3);
    expect(matches.every(m => m.rule.id === "rule-cargo")).toBe(true);
  });

  it("should rank the best keyword match first", () => {
    const matches = matcher.matchRules(
      createScene(),
      ["json", "unterminated", "repair"],
      undefined,
      undefined,
      undefined
    );

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.id).toBe("rule-json");
  });

  it("should return zero matches for unrelated keywords", () => {
    const matches = matcher.matchRules(
      createScene(),
      ["quantum", "blockchain", "nuclear"],
      undefined,
      undefined,
      undefined
    );

    expect(matches.length).toBe(0);
  });
});
