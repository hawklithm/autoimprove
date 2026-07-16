import { RuleIndexManager } from "./dist/storage/rule-index.js";
import { RuleMatcher } from "./dist/core/rule-matcher.js";
import { createScene } from "./dist/core/models.js";

const indexManager = new RuleIndexManager();
const matcher = new RuleMatcher(indexManager, 10, 0.3);

const tests = [
  ["cargo check workspace verify before proceeding", ["cargo","check","workspace"]],
  ["unterminated JSON key missing colon repair", ["json","unterminated","repair","colon"]],
];

for (const [desc, kws] of tests) {
  const matches = matcher.matchRules(createScene(), kws, undefined, undefined, undefined);
  console.log(`\n=== Query: ${desc} ===`);
  console.log(`Returned ${matches.length} rules (NOT 81):`);
  matches.slice(0,8).forEach((m,i) => {
    console.log(`  ${i+1}. ${m.rule.id} (rel=${m.relevance_score.toFixed(3)}) - ${m.match_reason}`);
  });
}
