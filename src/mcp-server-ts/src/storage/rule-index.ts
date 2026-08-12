/**
 * Rule index manager for AutoImprove.
 *
 * Manages the lightweight index file (rules/index.json) for fast rule loading.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { RuleIndex, RuleIndexEntry, createRuleContent, createRuleIndex, createScene } from "../core/models.js";
import { logger } from "./../core/logger.js";
import { RuleStorageSQLite } from "./rule-storage-sqlite.js";
import { SQLiteMigration } from "./migrate-to-sqlite.js";
import { RuleContentManager } from "./rule-content.js";
import { MemoryRepository } from "../core/memory-models.js";

/**
 * Normalize rule entry to ensure all fields are valid.
 * Fixes legacy data with missing/malformed fields.
 */
function normalizeRuleIndexEntry(entry: RuleIndexEntry | undefined | null): RuleIndexEntry | null {
  if (!entry) return null;

  return {
    ...entry,
    confidence: typeof entry.confidence === "number" && !isNaN(entry.confidence) ? entry.confidence : 0.5,
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    source_memory_ids: Array.isArray(entry.source_memory_ids) ? entry.source_memory_ids : [],
    scenes: createScene(entry.scenes || undefined) // Normalizes missing tech/functional/business arrays
  };
}

export class RuleIndexManager {
  private sqliteStorage: RuleStorageSQLite | null = null;
  private useSQLite: boolean = false;
  private needsMigration: boolean = false;

  private getStorageRoot(): string {
    return process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
  }

  private getRulesDir(): string {
    return join(this.getStorageRoot(), "rules");
  }

  private getIndexPath(): string {
    return join(this.getRulesDir(), "index.json");
  }

  private getDBPath(): string {
    return join(this.getRulesDir(), "rules.db");
  }

  constructor() {
    this.ensureDirectory();
    this.detectStorageBackend();
  }

  /**
   * Synchronously detect storage backend
   * Migration is deferred to explicit triggerMigration() call
   */
  private detectStorageBackend(): void {
    const dbExists = existsSync(this.getDBPath());
    const jsonExists = existsSync(this.getIndexPath());

    if (dbExists) {
      this.useSQLite = true;
      this.sqliteStorage = new RuleStorageSQLite();
      logger.info("rule-index", "Using SQLite storage backend");
    } else if (jsonExists) {
      this.useSQLite = false;
      this.needsMigration = true;
      logger.info("rule-index", "Using JSON storage (legacy). Call triggerMigration() to migrate to SQLite");
    } else {
      this.useSQLite = true;
      this.sqliteStorage = new RuleStorageSQLite();
      logger.info("rule-index", "Initializing new SQLite storage");
    }
  }

  async triggerMigration(): Promise<{success: boolean; migratedCount: number; errors: string[]}> {
    if (!this.needsMigration) {
      return { success: true, migratedCount: 0, errors: [] };
    }

    const migration = new SQLiteMigration();
    try {
      const result = await migration.migrate();
      if (result.success) {
        this.useSQLite = true;
        this.sqliteStorage = new RuleStorageSQLite();
        this.needsMigration = false;
        logger.info("rule-index", `Migration completed: ${result.migratedCount} rules`);
      }
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("rule-index", "Migration error", error as Error);
      return { success: false, migratedCount: 0, errors: [errorMsg] };
    }
  }

  getMigrationStatus(): {needsMigration: boolean; backend: string; dbPath?: string; jsonPath?: string} {
    return {
      needsMigration: this.needsMigration,
      backend: this.useSQLite ? 'SQLite' : 'JSON',
      dbPath: this.useSQLite ? this.getDBPath() : undefined,
      jsonPath: !this.useSQLite ? this.getIndexPath() : undefined
    };
  }

  getSQLiteStorage(): RuleStorageSQLite | null {
    return this.sqliteStorage;
  }

  private ensureDirectory(): void {
    const rulesDir = this.getRulesDir();
    if (!existsSync(rulesDir)) {
      mkdirSync(rulesDir, { recursive: true });
    }
  }

  loadIndex(): RuleIndex {
    if (this.useSQLite && this.sqliteStorage) {
      // Load from SQLite
      const rules = this.sqliteStorage.listAllRules();
      return {
        // Keep the public index contract compatible with the legacy JSON
        // backend; the physical backend is exposed through getMigrationStatus.
        version: "1.0",
        rules
      };
    }

    // Legacy JSON loading
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
      logger.consoleError("Failed to load rule index, returning empty index:", error);
      return createRuleIndex();
    }
  }

  saveIndex(index: RuleIndex): void {
    if (this.useSQLite && this.sqliteStorage) {
      // saveIndex historically meant "replace the complete index". Preserve
      // that behavior when the active backend is SQLite as well.
      this.sqliteStorage.clearAll();
      for (const entry of index.rules || []) {
        this.addRule(entry);
      }
      return;
    }

    this.ensureDirectory();

    const indexPath = this.getIndexPath();
    // Write to temp file first for atomic operation
    const tempPath = indexPath + ".tmp";
    writeFileSync(tempPath, JSON.stringify(index, null, 2));

    // Atomic rename
    renameSync(tempPath, indexPath);
  }

  addRule(entry: RuleIndexEntry, content?: any, memoryStore?: MemoryRepository): void {
    if (!entry) {
      throw new Error("Failed to normalize rule entry");
    }
    // Phase 3 / P1: when a memory store is supplied, reject rules whose every
    // memory reference is missing or inactive (orphaned reference).
    if (memoryStore && Array.isArray(entry.source_memory_ids) && entry.source_memory_ids.length > 0) {
      this.assertValidMemoryReferences(entry.source_memory_ids, memoryStore);
    }
    if (this.useSQLite && this.sqliteStorage) {
      // Check if rule exists
      const existing = this.sqliteStorage.getRule(entry.id);
      if (existing) {
        throw new Error(`Rule with ID ${entry.id} already exists`);
      }

      // Normalize before persisting
      const normalized = normalizeRuleIndexEntry(entry);
      if (!normalized) {
        throw new Error("Failed to normalize rule entry");
      }

      // For SQLite, we need content. If not provided, try to load it
      if (!content) {
        const contentManager = new RuleContentManager();
        content = contentManager.loadContent(entry.id);
        if (!content) {
          // Keep the index API backward compatible: older callers only
          // supplied an index entry. SQLite still requires a content row, so
          // materialize a minimal, deterministic fallback instead of failing
          // the entire rebuild.
          content = createRuleContent({
            id: entry.id,
            content: entry.description || entry.id,
            reason: "Imported from rule index"
          });
        }
      }

      this.sqliteStorage.addRule(normalized, content);
      return;
    }

    // Legacy JSON
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

  /**
   * Phase 3 / P1: throw if every supplied memory id is missing or not active.
   * A rule with only orphaned references must not enter the index.
   */
  private assertValidMemoryReferences(ids: string[], memoryStore: MemoryRepository): void {
    const active = memoryStore.list({ activeOnly: true });
    const activeSet = new Set(active.map((m) => m.id));
    const validCount = ids.filter((id) => activeSet.has(id)).length;
    if (validCount === 0) {
      throw new Error(`Rule references only orphaned/inactive memories: ${ids.join(", ")}`);
    }
  }

  updateRule(ruleId: string, updates: Partial<RuleIndexEntry>): void {
    if (this.useSQLite && this.sqliteStorage) {
      const existing = this.sqliteStorage.getRule(ruleId);
      if (!existing) {
        throw new Error(`Rule with ID ${ruleId} not found`);
      }

      this.sqliteStorage.updateRule(ruleId, updates);
      return;
    }

    // Legacy JSON
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
    if (this.useSQLite && this.sqliteStorage) {
      const existing = this.sqliteStorage.getRule(ruleId);
      if (!existing) {
        throw new Error(`Rule with ID ${ruleId} not found`);
      }

      this.sqliteStorage.deleteRule(ruleId);
      return;
    }

    // Legacy JSON
    const index = this.loadIndex();

    const originalCount = index.rules.length;
    index.rules = index.rules.filter(r => r.id !== ruleId);

    if (index.rules.length === originalCount) {
      throw new Error(`Rule with ID ${ruleId} not found`);
    }

    this.saveIndex(index);
  }

  /** Remove all indexed rules before a full batch rebuild. */
  clearAllRules(): number {
    if (this.useSQLite && this.sqliteStorage) {
      const rules = this.sqliteStorage.listAllRules();
      for (const rule of rules) {
        this.sqliteStorage.deleteRule(rule.id);
      }
      return rules.length;
    }

    const index = this.loadIndex();
    const removed = index.rules.length;
    index.rules = [];
    this.saveIndex(index);
    return removed;
  }

  getRule(ruleId: string): RuleIndexEntry | null {
    if (this.useSQLite && this.sqliteStorage) {
      return this.sqliteStorage.getRule(ruleId);
    }

    // Legacy JSON
    const index = this.loadIndex();
    const normalizedRuleId = ruleId.trim().toLowerCase();
    return index.rules.find(r => r.id.toLowerCase() === normalizedRuleId) || null;
  }

  listRules(options: {
    typeFilter?: string;
    priorityFilter?: string;
    minConfidence?: number;
  } = {}): RuleIndexEntry[] {
    if (this.useSQLite && this.sqliteStorage) {
      // SQLite backend
      let rules = this.sqliteStorage.listAllRules();

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

    // Legacy JSON
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
  replaceRule(ruleId: string, updatedEntry: RuleIndexEntry, content?: any): void {
    if (this.useSQLite && this.sqliteStorage) {
      const existing = this.sqliteStorage.getRule(ruleId);
      if (!existing) {
        throw new Error(`Rule with ID ${ruleId} not found`);
      }

      // Normalize before replacing
      const normalized = normalizeRuleIndexEntry(updatedEntry);
      if (!normalized) {
        throw new Error("Failed to normalize rule entry");
      }

      // Delete old and add new (ensures all indexes are updated)
      this.sqliteStorage.deleteRule(ruleId);

      // Load content if not provided
      if (!content) {
        const contentManager = new RuleContentManager();
        content = contentManager.loadContent(ruleId);
        if (!content) {
          throw new Error(`Content not found for rule ${ruleId}`);
        }
      }

      this.sqliteStorage.addRule(normalized, content);
      return;
    }

    // Legacy JSON
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

  /**
   * Get storage backend statistics
   */
  getStorageStats() {
    if (this.useSQLite && this.sqliteStorage) {
      return this.sqliteStorage.getStats();
    }

    const index = this.loadIndex();
    return {
      backend: "JSON",
      total_rules: index.rules.length,
      index_path: this.getIndexPath()
    };
  }

  /**
   * Close storage connections (cleanup)
   */
  close(): void {
    if (this.sqliteStorage) {
      this.sqliteStorage.close();
      this.sqliteStorage = null;
    }
  }
}
