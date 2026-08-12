/**
 * OrphanedRuleCleaner — Phase 4 / P1
 *
 * Scans every rule's `source_memory_ids` against the live memory store and
 * classifies each rule as:
 *   - fully_orphaned:    every referenced memory is missing / inactive
 *   - partially_orphaned: some references are valid, some are not
 *   - no_references:      rule has no memory references at all (legacy rule)
 *   - normal:             all references resolve to active memories
 *
 * It can then repair (trim to valid ids) or archive (fully orphaned) rules,
 * with an explicit dry-run mode that never mutates storage.
 */

import { existsSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { RuleIndexManager } from "../storage/rule-index.js";
import { RuleContentManager } from "../storage/rule-content.js";
import { MemoryRepository } from "./memory-models.js";
import { logger } from "./logger.js";

export type OrphanType =
  | "fully_orphaned"
  | "partially_orphaned"
  | "no_references"
  | "normal";

export type CleanAction = "report" | "archive" | "fix";
export type RuleActionTaken = "archived" | "fixed" | "kept" | "skipped" | "failed";

export interface OrphanedRuleDetail {
  rule_id: string;
  type: OrphanType;
  source_memory_ids: string[];
  valid_memory_ids: string[];
  orphaned_memory_ids: string[];
  action_taken?: RuleActionTaken;
  error?: string;
}

export interface OrphanedRuleReport {
  generated_at: string;
  storage_root: string;
  total_rules: number;
  fully_orphaned: number;
  partially_orphaned: number;
  no_references: number;
  normal: number;
  dry_run: boolean;
  whitelist: string[];
  rules: OrphanedRuleDetail[];
}

export interface CleanOrphanedOptions {
  action?: CleanAction;
  dryRun?: boolean;
  whitelist?: string[];
}

export class OrphanedRuleCleaner {
  private contentManager: RuleContentManager;

  constructor(
    private ruleIndex: RuleIndexManager,
    private memoryStore?: MemoryRepository,
    contentManager?: RuleContentManager
  ) {
    this.contentManager = contentManager || new RuleContentManager();
  }

  private getStorageRoot(): string {
    return process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
  }

  private resolveActiveMemoryIds(): Set<string> {
    if (!this.memoryStore) return new Set();
    return new Set(this.memoryStore.list({ activeOnly: true }).map((m) => m.id));
  }

  /**
   * Pure audit — never mutates storage.
   */
  audit(): OrphanedRuleReport {
    const rules = this.ruleIndex.listRules();
    const activeMem = this.resolveActiveMemoryIds();
    return this.buildReport(rules, activeMem, { action: "report", dryRun: false, whitelist: [] });
  }

  /**
   * Audit and (optionally) repair/archive rules.
   * Default is dry-run (no mutation) unless dryRun is explicitly false.
   */
  clean(options: CleanOrphanedOptions = {}): OrphanedRuleReport {
    const action: CleanAction = options.action || "report";
    const dryRun = options.dryRun !== false; // default true
    const whitelist = options.whitelist || [];

    const rules = this.ruleIndex.listRules();
    const activeMem = this.resolveActiveMemoryIds();
    const report = this.buildReport(rules, activeMem, { action, dryRun, whitelist });

    if (action === "report" || dryRun) {
      return report;
    }

    for (const detail of report.rules) {
      const ids = detail.source_memory_ids;
      if (ids.length === 0) {
        detail.action_taken = "kept";
        continue;
      }
      if (whitelist.includes(detail.rule_id)) {
        detail.action_taken = "skipped";
        continue;
      }

      try {
        if (action === "archive" && detail.type === "fully_orphaned") {
          this.ruleIndex.updateRule(detail.rule_id, { status: "archived" });
          this.archiveContent(detail.rule_id);
          detail.action_taken = "archived";
        } else if (action === "fix" && detail.type === "partially_orphaned") {
          this.ruleIndex.updateRule(detail.rule_id, { source_memory_ids: detail.valid_memory_ids });
          detail.action_taken = "fixed";
        } else {
          detail.action_taken = "kept";
        }
      } catch (error) {
        detail.action_taken = "failed";
        detail.error = error instanceof Error ? error.message : String(error);
        logger.error("orphaned-rule-cleaner", `Failed to process ${detail.rule_id}`, error as Error);
      }
    }

    return report;
  }

  private buildReport(
    rules: ReturnType<RuleIndexManager["listRules"]>,
    activeMem: Set<string>,
    opts: { action: CleanAction; dryRun: boolean; whitelist: string[] }
  ): OrphanedRuleReport {
    const details: OrphanedRuleDetail[] = [];
    let fully = 0;
    let partial = 0;
    let noref = 0;
    let normal = 0;

    for (const rule of rules) {
      const ids = Array.isArray(rule.source_memory_ids) ? rule.source_memory_ids : [];
      if (ids.length === 0) {
        noref++;
        details.push({
          rule_id: rule.id,
          type: "no_references",
          source_memory_ids: [],
          valid_memory_ids: [],
          orphaned_memory_ids: [],
        });
        continue;
      }

      const valid = ids.filter((id) => activeMem.has(id));
      const orphaned = ids.filter((id) => !activeMem.has(id));

      let type: OrphanType;
      if (valid.length === 0) {
        type = "fully_orphaned";
        fully++;
      } else if (orphaned.length > 0) {
        type = "partially_orphaned";
        partial++;
      } else {
        type = "normal";
        normal++;
      }

      details.push({
        rule_id: rule.id,
        type,
        source_memory_ids: ids,
        valid_memory_ids: valid,
        orphaned_memory_ids: orphaned,
      });
    }

    return {
      generated_at: new Date().toISOString(),
      storage_root: this.getStorageRoot(),
      total_rules: rules.length,
      fully_orphaned: fully,
      partially_orphaned: partial,
      no_references: noref,
      normal,
      dry_run: opts.dryRun,
      whitelist: opts.whitelist,
      rules: details,
    };
  }

  /** Move a rule's content file into the archive/ folder, keeping a backup. */
  private archiveContent(ruleId: string): void {
    const contentDir = join(this.getStorageRoot(), "rules", "content");
    const archiveDir = join(contentDir, "archive");
    const src = join(contentDir, `${ruleId}.md`);
    if (!existsSync(src)) return;
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true });
    }
    const dest = join(archiveDir, `${ruleId}.md`);
    try {
      renameSync(src, dest);
    } catch (error) {
      logger.warn("orphaned-rule-cleaner", `Could not move content for ${ruleId}: ${String(error)}`);
    }
  }
}
