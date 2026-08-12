#!/usr/bin/env node
/**
 * Phase 4 / P1 — Orphaned rule cleanup CLI.
 *
 * Scans all rules for orphaned/inactive memory references and (optionally)
 * archives fully-orphaned rules or fixes partially-orphaned rules.
 *
 * Usage:
 *   npx tsx scripts/cleanup-orphaned-rules.ts [--action report|archive|fix]
 *                                             [--apply] [--whitelist id,id2]
 *
 * Default is a dry-run (--action report, no mutation). Pass --apply to mutate
 * storage. --whitelist takes a comma-separated list of rule ids to never touch.
 */

import { RuleIndexManager } from "../src/storage/rule-index.js";
import { OrphanedRuleCleaner } from "../src/core/orphaned-rule-cleaner.js";
import { createDefaultMemoryRepository } from "../src/storage/memory-sqlite-store.js";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const action = (get("--action") as "report" | "archive" | "fix") || "report";
  const dryRun = !args.includes("--apply");
  const whitelistRaw = get("--whitelist");
  const whitelist = whitelistRaw
    ? whitelistRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  return { action, dryRun, whitelist };
}

function main() {
  const { action, dryRun, whitelist } = parseArgs(process.argv);

  const ruleIndex = new RuleIndexManager();
  const memoryStore = createDefaultMemoryRepository();
  memoryStore.reload?.();

  const cleaner = new OrphanedRuleCleaner(ruleIndex, memoryStore);
  const report = cleaner.clean({ action, dryRun, whitelist });

  console.log("==============================================");
  console.log(" AutoImprove — Orphaned Rule Cleanup");
  console.log("==============================================");
  console.log(` Storage root : ${report.storage_root}`);
  console.log(` Action       : ${action}`);
  console.log(` Dry run      : ${dryRun ? "YES (no changes)" : "NO (mutating)"}`);
  console.log(` Whitelist    : ${whitelist.length ? whitelist.join(", ") : "(none)"}`);
  console.log("----------------------------------------------");
  console.log(` Total rules           : ${report.total_rules}`);
  console.log(` Fully orphaned        : ${report.fully_orphaned}`);
  console.log(` Partially orphaned    : ${report.partially_orphaned}`);
  console.log(` No references (legacy): ${report.no_references}`);
  console.log(` Normal                : ${report.normal}`);
  console.log("----------------------------------------------");

  const flagged = report.rules.filter(
    (r) => r.type === "fully_orphaned" || r.type === "partially_orphaned"
  );
  if (flagged.length === 0) {
    console.log("✅ No orphaned rules detected.");
  } else {
    console.log("Flagged rules:");
    for (const r of flagged) {
      const acted = r.action_taken ? ` → ${r.action_taken}` : "";
      const err = r.error ? ` (error: ${r.error})` : "";
      console.log(
        `  • ${r.rule_id} [${r.type}] valid=${r.valid_memory_ids.length} orphaned=${r.orphaned_memory_ids.length}${acted}${err}`
      );
    }
  }

  if (dryRun && action !== "report") {
    console.log("\n⚠ Dry-run: no changes were made. Re-run with --apply to mutate storage.");
  }
  console.log("==============================================");
}

main();
