/**
 * Rule index manager for AutoImprove.
 *
 * Manages the lightweight index file (rules/index.json) for fast rule loading.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { RuleIndex, RuleIndexEntry, createRuleIndex } from "../core/models.js";

export class RuleIndexManager {
  private getStorageRoot(): string {
    return process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
  }

  private getRulesDir(): string {
    return join(this.getStorageRoot(), "rules");
  }

  private getIndexPath(): string {
    return join(this.getRulesDir(), "index.json");
  }

  constructor() {
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    const rulesDir = this.getRulesDir();
    if (!existsSync(rulesDir)) {
      mkdirSync(rulesDir, { recursive: true });
    }
  }

  loadIndex(): RuleIndex {
    const indexPath = this.getIndexPath();
    if (!existsSync(indexPath)) {
      return createRuleIndex();
    }

    const data = readFileSync(indexPath, "utf-8");
    return JSON.parse(data) as RuleIndex;
  }

  saveIndex(index: RuleIndex): void {
    this.ensureDirectory();

    const indexPath = this.getIndexPath();
    // Write to temp file first for atomic operation
    const tempPath = indexPath + ".tmp";
    writeFileSync(tempPath, JSON.stringify(index, null, 2));

    // Atomic rename
    renameSync(tempPath, indexPath);
  }

  addRule(entry: RuleIndexEntry): void {
    const index = this.loadIndex();

    // Check if rule ID already exists
    if (index.rules.some(r => r.id === entry.id)) {
      throw new Error(`Rule with ID ${entry.id} already exists`);
    }

    index.rules.push(entry);
    this.saveIndex(index);
  }

  updateRule(ruleId: string, updates: Partial<RuleIndexEntry>): void {
    const index = this.loadIndex();

    // Find rule
    const rule = index.rules.find(r => r.id === ruleId);
    if (!rule) {
      throw new Error(`Rule with ID ${ruleId} not found`);
    }

    // Update fields
    Object.assign(rule, updates);

    // Update timestamp
    rule.updated_at = new Date().toISOString();

    this.saveIndex(index);
  }

  removeRule(ruleId: string): void {
    const index = this.loadIndex();

    const originalCount = index.rules.length;
    index.rules = index.rules.filter(r => r.id !== ruleId);

    if (index.rules.length === originalCount) {
      throw new Error(`Rule with ID ${ruleId} not found`);
    }

    this.saveIndex(index);
  }

  getRule(ruleId: string): RuleIndexEntry | null {
    const index = this.loadIndex();
    return index.rules.find(r => r.id === ruleId) || null;
  }

  listRules(options: {
    typeFilter?: string;
    priorityFilter?: string;
    minConfidence?: number;
  } = {}): RuleIndexEntry[] {
    const index = this.loadIndex();
    let rules = index.rules;

    if (options.typeFilter) {
      rules = rules.filter(r => r.type === options.typeFilter);
    }

    if (options.priorityFilter) {
      rules = rules.filter(r => r.priority === options.priorityFilter);
    }

    if (options.minConfidence !== undefined) {
      rules = rules.filter(r => r.confidence >= options.minConfidence!);
    }

    return rules;
  }

  getNextRuleId(): string {
    const index = this.loadIndex();

    if (index.rules.length === 0) {
      return "rule-001";
    }

    // Extract numeric IDs
    let maxNum = 0;
    for (const rule of index.rules) {
      if (rule.id.startsWith("rule-")) {
        const parts = rule.id.split("-");
        if (parts.length === 2) {
          const num = parseInt(parts[1], 10);
          if (!isNaN(num)) {
            maxNum = Math.max(maxNum, num);
          }
        }
      }
    }

    return `rule-${String(maxNum + 1).padStart(3, "0")}`;
  }

  invalidateCache(): void {
    // Placeholder for cache invalidation
    // Will be used by RuleMatcher
  }
}
