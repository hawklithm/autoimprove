/**
 * RuleAuditor — Phase 4 / P2
 *
 * Scans the entire rule set and produces a structured audit report covering:
 *   - empty_scene:         rule scenes (tech/functional/business) are all empty
 *   - low_quality:         unified quality score < threshold (default 0.5)
 *   - orphaned_memory:     one or more source_memory_ids are missing / inactive
 *   - high_business_ratio: rule content is business-dominated (non-coding)
 *
 * The report is written to `~/.autoimprove/audit_report.json` and can drive a
 * batch archive pass (with whitelist support).
 */

import { writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { RuleIndexManager } from "../storage/rule-index.js";
import { RuleContentManager } from "../storage/rule-content.js";
import { MemoryRepository } from "./memory-models.js";
import { RuleQualityController } from "./rule-quality.js";
import { PatternContentFilter } from "./pattern-content-filter.js";
import { RuleContent } from "./models.js";
import { logger } from "./logger.js";

export type AuditIssueType =
  | "empty_scene"
  | "low_quality"
  | "orphaned_memory"
  | "high_business_ratio";

export type AuditSeverity = "high" | "medium";

export interface RuleAuditIssue {
  rule_id: string;
  issue_type: AuditIssueType;
  severity: AuditSeverity;
  metric: number;
  detail: string;
}

export interface RuleAuditSummary {
  empty_scene: number;
  low_quality: number;
  orphaned_memory: number;
  high_business_ratio: number;
}

export interface RuleAuditReport {
  generated_at: string;
  storage_root: string;
  total_rules: number;
  quality_threshold: number;
  issues: RuleAuditIssue[];
  summary: RuleAuditSummary;
  report_path?: string;
}

export interface BatchArchiveResult {
  dry_run: boolean;
  archived: string[];
  skipped: string[];
  failed: { rule_id: string; error: string }[];
}

export class RuleAuditor {
  private contentManager: RuleContentManager;
  private qualityController: RuleQualityController;
  private contentFilter: PatternContentFilter;

  constructor(
    private ruleIndex: RuleIndexManager,
    private memoryStore?: MemoryRepository,
    contentManager?: RuleContentManager,
    qualityController?: RuleQualityController
  ) {
    this.contentManager = contentManager || new RuleContentManager();
    this.qualityController = qualityController || new RuleQualityController();
    this.contentFilter = new PatternContentFilter();
  }

  private getStorageRoot(): string {
    return process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
  }

  private resolveActiveMemoryIds(): Set<string> {
    if (!this.memoryStore) return new Set();
    return new Set(this.memoryStore.list({ activeOnly: true }).map((m) => m.id));
  }

  /**
   * Build a minimal RuleContent from an index entry when the content file is
   * unavailable (e.g. legacy rules). Keeps the quality scorer happy.
   */
  private toRuleContent(ruleId: string, description?: string): RuleContent {
    const loaded = this.contentManager.loadContent(ruleId);
    if (loaded) return loaded;
    return {
      id: ruleId,
      content: description || ruleId,
      reason: "",
      metadata: {},
    };
  }

  generate(qualityThreshold = 0.5): RuleAuditReport {
    const rules = this.ruleIndex.listRules();
    const activeMem = this.resolveActiveMemoryIds();
    const issues: RuleAuditIssue[] = [];
    const summary: RuleAuditSummary = {
      empty_scene: 0,
      low_quality: 0,
      orphaned_memory: 0,
      high_business_ratio: 0,
    };

    for (const rule of rules) {
      const content = this.toRuleContent(rule.id, rule.description);

      // 1. Empty scene
      const sceneComp = this.qualityController.assessSceneCompleteness(rule);
      if (sceneComp === 0) {
        issues.push({
          rule_id: rule.id,
          issue_type: "empty_scene",
          severity: "high",
          metric: 0,
          detail: "rule has no tech/functional/business scenes",
        });
        summary.empty_scene++;
      }

      // 2. Low quality
      const score = this.qualityController.assessUnifiedScore(
        content,
        rule,
        rule.confidence ?? 0.5
      );
      if (score.overall < qualityThreshold) {
        issues.push({
          rule_id: rule.id,
          issue_type: "low_quality",
          severity: "high",
          metric: Number(score.overall.toFixed(3)),
          detail: `unified quality score ${score.overall.toFixed(3)} < ${qualityThreshold}`,
        });
        summary.low_quality++;
      }

      // 3. Orphaned memory references
      const ids = Array.isArray(rule.source_memory_ids) ? rule.source_memory_ids : [];
      const orphaned = ids.filter((id) => !activeMem.has(id));
      if (ids.length > 0 && orphaned.length > 0) {
        issues.push({
          rule_id: rule.id,
          issue_type: "orphaned_memory",
          severity: "medium",
          metric: orphaned.length,
          detail: `orphaned memory refs: ${orphaned.join(", ")}`,
        });
        summary.orphaned_memory++;
      }

      // 4. Business-dominated content (non-coding rule)
      const filterResult = this.contentFilter.isCodeRelated(content.content || "");
      if (!filterResult.allowed && filterResult.category !== "general") {
        issues.push({
          rule_id: rule.id,
          issue_type: "high_business_ratio",
          severity: "medium",
          metric: filterResult.businessScore,
          detail: `business-dominated content (category=${filterResult.category}, code=${filterResult.codeScore}, business=${filterResult.businessScore})`,
        });
        summary.high_business_ratio++;
      }
    }

    return {
      generated_at: new Date().toISOString(),
      storage_root: this.getStorageRoot(),
      total_rules: rules.length,
      quality_threshold: qualityThreshold,
      issues,
      summary,
    };
  }

  /**
   * Persist the audit report to disk (~/.autoimprove/audit_report.json).
   */
  writeReport(report: RuleAuditReport, path?: string): string {
    const reportPath = path || join(this.getStorageRoot(), "audit_report.json");
    const dir = reportPath.substring(0, reportPath.lastIndexOf("/"));
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const withPath = { ...report, report_path: reportPath };
    writeFileSync(reportPath, JSON.stringify(withPath, null, 2), "utf-8");
    logger.info("rule-auditor", `Audit report written to ${reportPath}`);
    return reportPath;
  }

  /**
   * Archive rules that have high-severity issues (empty_scene / low_quality /
   * orphaned_memory), excluding any whitelisted rule ids.
   * dry-run by default.
   */
  batchArchive(
    report: RuleAuditReport,
    whitelist: string[] = [],
    dryRun = true
  ): BatchArchiveResult {
    const flagged = new Set(
      report.issues
        .filter((i) => i.severity === "high")
        .map((i) => i.rule_id)
    );

    const result: BatchArchiveResult = { dry_run: dryRun, archived: [], skipped: [], failed: [] };

    for (const ruleId of flagged) {
      if (whitelist.includes(ruleId)) {
        result.skipped.push(ruleId);
        continue;
      }
      if (dryRun) {
        result.archived.push(ruleId); // would-be archived (dry run)
        continue;
      }
      try {
        this.ruleIndex.updateRule(ruleId, { status: "archived" });
        const root = this.getStorageRoot();
        const src = join(root, "rules", "content", `${ruleId}.md`);
        const archiveDir = join(root, "rules", "content", "archive");
        if (existsSync(src)) {
          if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });
          try {
            renameSync(src, join(archiveDir, `${ruleId}.md`));
          } catch (e) {
            logger.warn("rule-auditor", `Could not move content for ${ruleId}: ${String(e)}`);
          }
        }
        result.archived.push(ruleId);
      } catch (error) {
        result.failed.push({
          rule_id: ruleId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }
}
