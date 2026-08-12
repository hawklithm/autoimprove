#!/usr/bin/env node
/**
 * Phase 4 / P2 — Full rule-set audit CLI.
 *
 * Detects empty scenes, low-quality scores, orphaned memory references, and
 * business-dominated content, writes a report to ~/.autoimprove/audit_report.json,
 * and can batch-archive high-severity flagged rules (dry-run by default).
 *
 * Usage:
 *   npx tsx scripts/audit-rules.ts [--quality-threshold 0.5] [--report-path PATH]
 *                                 [--no-report] [--batch-archive] [--apply]
 *                                 [--whitelist id,id2]
 */

import { RuleIndexManager } from "../src/storage/rule-index.js";
import { RuleAuditor } from "../src/core/rule-auditor.js";
import { createDefaultMemoryRepository } from "../src/storage/memory-sqlite-store.js";

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const thresholdRaw = get("--quality-threshold");
  const qualityThreshold = thresholdRaw ? Number(thresholdRaw) : 0.5;
  const reportPath = get("--report-path");
  const writeReport = !args.includes("--no-report");
  const batchArchive = args.includes("--batch-archive");
  const dryRun = !args.includes("--apply");
  const whitelistRaw = get("--whitelist");
  const whitelist = whitelistRaw
    ? whitelistRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  return { qualityThreshold, reportPath, writeReport, batchArchive, dryRun, whitelist };
}

function main() {
  const { qualityThreshold, reportPath, writeReport, batchArchive, dryRun, whitelist } =
    parseArgs(process.argv);

  const ruleIndex = new RuleIndexManager();
  const memoryStore = createDefaultMemoryRepository();
  memoryStore.reload?.();

  const auditor = new RuleAuditor(ruleIndex, memoryStore);
  const report = auditor.generate(qualityThreshold);

  let outPath: string | undefined;
  if (writeReport) {
    outPath = auditor.writeReport(report, reportPath);
  }

  console.log("==============================================");
  console.log(" AutoImprove — Rule Audit");
  console.log("==============================================");
  console.log(` Quality threshold : ${qualityThreshold}`);
  console.log(` Total rules       : ${report.total_rules}`);
  console.log(` Issues found      : ${report.issues.length}`);
  if (outPath) console.log(` Report written    : ${outPath}`);
  console.log("----------------------------------------------");
  console.log(` Empty scene        : ${report.summary.empty_scene}`);
  console.log(` Low quality        : ${report.summary.low_quality}`);
  console.log(` Orphaned memory    : ${report.summary.orphaned_memory}`);
  console.log(` Business-dominated : ${report.summary.high_business_ratio}`);
  console.log("----------------------------------------------");

  if (report.issues.length > 0) {
    console.log("Issues:");
    for (const issue of report.issues) {
      console.log(`  • ${issue.rule_id} [${issue.issue_type}/${issue.severity}] ${issue.detail}`);
    }
  } else {
    console.log("✅ No issues detected.");
  }

  if (batchArchive) {
    console.log("----------------------------------------------");
    const result = auditor.batchArchive(report, whitelist, dryRun);
    const verb = dryRun ? "Would archive" : "Archived";
    console.log(
      `${verb} ${result.archived.length} rule(s)${dryRun ? " (dry-run)" : ""}: ${
        result.archived.join(", ") || "(none)"
      }`
    );
    if (result.skipped.length) {
      console.log(`Skipped (whitelisted): ${result.skipped.join(", ")}`);
    }
    if (result.failed.length) {
      console.log("Failed:");
      for (const f of result.failed) console.log(`  ✗ ${f.rule_id}: ${f.error}`);
    }
    if (dryRun) {
      console.log("\n⚠ Dry-run: no changes were made. Re-run with --apply to archive.");
    }
  }

  console.log("==============================================");
}

main();
