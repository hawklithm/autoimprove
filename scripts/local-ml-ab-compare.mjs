#!/usr/bin/env node
/**
 * local-ml-ab-compare — G2 parallel A/B comparison helper.
 *
 * Runs SessionAnalyzer on a session file under two configurations:
 *   1. LEGACY  (local_ml disabled — original behavior)
 *   2. LOCAL_ML (clusterer + signal_match + pattern_clusterer enabled, semantic)
 *
 * Emits a side-by-side comparison of detected pattern counts / types so an
 * operator can decide when to raise ab_test.rollout toward 1.
 *
 * Usage:
 *   node scripts/local-ml-ab-compare.mjs <session.jsonl> [--storage-root /tmp/ab]
 *
 * Requires the project to be built (dist/) OR run via `tsx`.
 */

import { mkdtempSync, rmSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const sessionFile = process.argv[2];
if (!sessionFile || !existsSync(sessionFile)) {
  console.error("Usage: node scripts/local-ml-ab-compare.mjs <session.jsonl>");
  process.exit(1);
}
const customRoot = process.argv.includes("--storage-root")
  ? process.argv[process.argv.indexOf("--storage-root") + 1]
  : mkdtempSync(join(tmpdir(), "ab-"));

async function runWithConfig(localMlEnabled) {
  process.env.AUTOIMPROVE_STORAGE_ROOT = customRoot;
  const cfgPath = join(customRoot, "config.json");
  const base = {
    version: "1.0",
    confidence_thresholds: {},
    confidence_weights: {},
    rule_matching: { max_results: 10, min_confidence: 0.3 },
    business_domain_mappings: {},
    local_ml: {
      enabled: localMlEnabled,
      embedding_backend: "char-ngram-tfidf",
      prefilter: { enabled: false, mode: "heuristic" },
      clusterer: localMlEnabled ? "kmeans" : "legacy",
      pattern_clusterer: localMlEnabled ? "semantic" : "legacy",
      signal_match: { mode: localMlEnabled ? "neighbor" : "legacy", threshold: 0.62 },
      personalization: { enabled: false, per_user: false },
      ab_test: { rollout: localMlEnabled ? 1 : 0 },
    },
  };
  writeFileSync(cfgPath, JSON.stringify(base, null, 2));

  // Import lazily (ESM) so env/config are set before module init.
  const { SessionAnalyzer } = await import("../src/mcp-server-ts/dist/core/session-analyzer.js");
  const analyzer = new SessionAnalyzer();
  const patterns = analyzer.analyzeSession(sessionFile, { forceReanalyze: true, useCompactCache: false });
  analyzer.clearCache?.(undefined);
  return patterns;
}

function summarize(patterns) {
  const byType = {};
  for (const p of patterns) byType[p.type] = (byType[p.type] || 0) + 1;
  return { total: patterns.length, byType };
}

console.log(`\n=== A/B comparison for ${sessionFile} ===\n`);
const legacy = summarize(await runWithConfig(false));
const localMl = summarize(await runWithConfig(true));

console.log("LEGACY  :", JSON.stringify(legacy));
console.log("LOCAL_ML:", JSON.stringify(localMl));
const delta = localMl.total - legacy.total;
console.log(`\nΔ patterns (local_ml - legacy): ${delta >= 0 ? "+" : ""}${delta}`);
console.log("Rollout recommendation: keep rollout low until local_ml delta is stable & recall verified.\n");

rmSync(customRoot, { recursive: true, force: true });
