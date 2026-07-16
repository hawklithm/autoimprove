// Verify RuleMatcher.matchRules keyword path WITHOUT touching the real SQLite DB
// by constructing an in-memory ruleset and stubbing getSQLiteStorage to null.
import { RuleMatcher } from "./dist/core/rule-matcher.js";
import { createScene } from "./dist/core/models.js";
import { RuleIndexManager } from "./dist/storage/rule-index.js";

// Stub the index manager to return a small in-memory ruleset
class FakeIndexManager {
  getAllRules() {
    return [
      { id: "rule-025", type: "repeated-correction", priority: "high", confidence: 0.9,
        scenes: createScene(), scope: "global", scope_context: {}, keywords: ["cargo","check","workspace","rust"], created_at: "", updated_at: "" },
      { id: "rule-001", type: "anti-pattern", priority: "medium", confidence: 0.8,
        scenes: createScene(), scope: "global", scope_context: {}, keywords: ["refactor","class","interface"], created_at: "", updated_at: "" },
      { id: "rule-031-b", type: "performance", priority: "high", confidence: 0.85,
        scenes: createScene(), scope: "global", scope_context: {}, keywords: ["json","unterminated","repair","parse"], created_at: "", updated_at: "" },
    ];
  }
  getSQLiteStorage() { return null; } // force memory path
  listRules() { return this.getAllRules(); }
}

const matcher = new RuleMatcher(new FakeIndexManager(), 10, 0.3);

console.log("=== Query: cargo check workspace ===");
let m = matcher.matchRules(createScene(), ["cargo","check","workspace"], undefined, undefined, undefined);
console.log(`Returned ${m.length} rules:`, m.map(x=>`${x.rule.id}(${x.relevance_score.toFixed(3)})`));

console.log("\n=== Query: json unterminated repair ===");
m = matcher.matchRules(createScene(), ["json","unterminated","repair"], undefined, undefined, undefined);
console.log(`Returned ${m.length} rules:`, m.map(x=>`${x.rule.id}(${x.relevance_score.toFixed(3)})`));

console.log("\n=== Query: unrelated gibberish ===");
m = matcher.matchRules(createScene(), ["quantum","blockchain"], undefined, undefined, undefined);
console.log(`Returned ${m.length} rules (should be 0)`);
