/**
 * Rule index manager for AutoImprove.
 *
 * Manages the lightweight index file (rules/index.json) for fast rule loading.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { RuleIndex, RuleIndexEntry, createRuleIndex, createScene } from "../core/models.js";

/**
 * Normalize rule entry to ensure all fields are valid.
 * Fixes legacy data with missing/malformed fields.
 */
function normalizeRuleIndexEntry(entry: RuleIndexEntry | undefined | null): RuleIndexEntry | null {
  if (!entry) return null;

  return {
    ...entry,
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    scenes: createScene(entry.scenes || undefined) // Normalizes missing tech/functional/business arrays
  };
}

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

    try {
      const data = readFileSync(indexPath, "utf-8");
      const index = JSON.parse(data) as RuleIndex;

      // Normalize all rules on load (one-time data migration for legacy entries)
      // Filter out null results from normalization failures
      if (index.rules && Array.isArray(index.rules)) {
        index.rules = index.rules
          .map(normalizeRuleIndexEntry)
          .filter((r): r is RuleIndexEntry => r !== null);
      } else {
        index.rules = [];
      }

      return index;
    } catch (error) {
      // console.error("Failed to load rule index, returning empty index:", error);
      return createRuleIndex();
    }
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

    // Normalize before persisting
    const normalized = normalizeRuleIndexEntry(entry);
    if (normalized) {
      index.rules.push(normalized);
      this.saveIndex(index);
    } else {
      throw new Error("Failed to normalize rule entry");
    }
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

  /**
   * Get all rules (for deduplication)
   */
  getAllRules(): RuleIndexEntry[] {
    const index = this.loadIndex();
    return index.rules;
  }

  /**
   * Replace a rule with updated version (for merging)
   */
  replaceRule(ruleId: string, updatedEntry: RuleIndexEntry): void {
    const index = this.loadIndex();

    const ruleIndex = index.rules.findIndex(r => r.id === ruleId);
    if (ruleIndex === -1) {
      throw new Error(`Rule with ID ${ruleId} not found`);
    }

    // Normalize before replacing
    const normalized = normalizeRuleIndexEntry(updatedEntry);
    if (!normalized) {
      throw new Error("Failed to normalize rule entry");
    }

    index.rules[ruleIndex] = normalized;
    this.saveIndex(index);
  }
}
