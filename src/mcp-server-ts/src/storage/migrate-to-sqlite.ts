/**
 * Migration script: JSON to SQLite
 *
 * Migrates existing rule storage from JSON-based (index.json + content/*.md)
 * to SQLite-based storage with FTS5 and indexing.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { RuleStorageSQLite } from "./rule-storage-sqlite.js";
import type { RuleContent } from "../core/models.js";
import { RuleIndexEntry } from "../core/models.js";
import { logger } from "../core/logger.js";

interface LegacyIndex {
  version: string;
  rules: RuleIndexEntry[];
}

export class SQLiteMigration {
  private storageRoot: string;
  private indexPath: string;

  constructor() {
    this.storageRoot = process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
    this.indexPath = join(this.storageRoot, "rules", "index.json");
  }

  /**
   * Load rule content from markdown file
   */
  private loadRuleContent(ruleId: string): RuleContent | null {
    const contentPath = join(this.storageRoot, "rules", "content", `${ruleId}.md`);
    if (!existsSync(contentPath)) {
      return null;
    }

    try {
      const content = readFileSync(contentPath, "utf-8");

      // Parse frontmatter and content
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!frontmatterMatch) {
        return {
          id: ruleId,
          content: content,
          title: ruleId,
          description: content,
          reason: '',
          metadata: {}
        };
      }

      const [, frontmatter, body] = frontmatterMatch;
      const metadata: any = {};

      // Parse YAML-like frontmatter
      frontmatter.split('\n').forEach(line => {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
          const [, key, value] = match;
          metadata[key] = value.replace(/^["']|["']$/g, '');
        }
      });

      return {
        id: ruleId,
        content: body.trim(),
        title: metadata.title || ruleId,
        description: metadata.description || '',
        reason: metadata.reason || '',
        how_to_apply: metadata.how_to_apply ? [metadata.how_to_apply] : undefined,
        when_to_use: metadata.when_to_use ? [metadata.when_to_use] : undefined,
        exceptions: metadata.exceptions ? [metadata.exceptions] : undefined,
        metadata
      };
    } catch (error) {
      logger.error("migrate-to-sqlite", `Failed to load content for ${ruleId}`, error as Error);
      return null;
    }
  }

  /**
   * Check if migration is needed
   */
  needsMigration(): boolean {
    const dbPath = join(this.storageRoot, "rules", "rules.db");
    const hasLegacyIndex = existsSync(this.indexPath);
    const hasSQLiteDB = existsSync(dbPath);

    return hasLegacyIndex && !hasSQLiteDB;
  }

  /**
   * Run migration
   */
  async migrate(): Promise<{ success: boolean; migratedCount: number; errors: string[] }> {
    logger.info("sqlite-migration", "Starting migration from JSON to SQLite");

    if (!existsSync(this.indexPath)) {
      return {
        success: false,
        migratedCount: 0,
        errors: ["Legacy index.json not found"]
      };
    }

    const errors: string[] = [];
    let migratedCount = 0;

    try {
      // Load legacy index
      const legacyData = JSON.parse(readFileSync(this.indexPath, "utf-8")) as LegacyIndex;
      logger.info("sqlite-migration", `Found ${legacyData.rules.length} rules to migrate`);

      // Initialize SQLite storage
      const sqliteStorage = new RuleStorageSQLite();

      // Migrate each rule
      for (const entry of legacyData.rules) {
        try {
          // Load content from markdown file
          const content = this.loadRuleContent(entry.id);
          if (!content) {
            errors.push(`Failed to load content for rule ${entry.id}`);
            continue;
          }

          // Insert into SQLite
          sqliteStorage.addRule(entry, content);
          migratedCount++;

          if (migratedCount % 10 === 0) {
            logger.info("sqlite-migration", `Migrated ${migratedCount}/${legacyData.rules.length} rules`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push(`Error migrating rule ${entry.id}: ${errorMsg}`);
          logger.error("sqlite-migration", `Failed to migrate rule ${entry.id}`, error as Error);
        }
      }

      sqliteStorage.close();

      // Backup legacy files
      if (migratedCount > 0) {
        this.backupLegacyFiles();
      }

      logger.info("sqlite-migration", `Migration complete: ${migratedCount} rules migrated, ${errors.length} errors`);

      return {
        success: errors.length === 0,
        migratedCount,
        errors
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("sqlite-migration", "Migration failed", error as Error);
      return {
        success: false,
        migratedCount,
        errors: [...errors, `Fatal error: ${errorMsg}`]
      };
    }
  }

  /**
   * Backup legacy JSON files
   */
  private backupLegacyFiles(): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(this.storageRoot, "rules", `index.json.backup-${timestamp}`);

    try {
      renameSync(this.indexPath, backupPath);
      logger.info("sqlite-migration", `Legacy index.json backed up to ${backupPath}`);
    } catch (error) {
      logger.warn("sqlite-migration", "Failed to backup legacy index.json", error as Error);
    }
  }

  /**
   * Rollback migration (restore from backup)
   */
  rollback(): boolean {
    try {
      const dbPath = join(this.storageRoot, "rules", "rules.db");
      const backupDir = join(this.storageRoot, "rules");

      // Find most recent backup
      const backupFiles = readdirSync(backupDir)
        .filter((f: string) => f.startsWith("index.json.backup-"))
        .sort()
        .reverse();

      if (backupFiles.length === 0) {
        logger.error("sqlite-migration", "No backup found for rollback");
        return false;
      }

      const latestBackup = join(backupDir, backupFiles[0]);

      // Remove SQLite database
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
        logger.info("sqlite-migration", "Removed SQLite database");
      }

      // Restore backup
      renameSync(latestBackup, this.indexPath);
      logger.info("sqlite-migration", `Restored backup from ${latestBackup}`);

      return true;
    } catch (error) {
      logger.error("sqlite-migration", "Rollback failed", error as Error);
      return false;
    }
  }

  /**
   * Get migration status
   */
  getStatus(): {
    hasSQLite: boolean;
    hasLegacy: boolean;
    needsMigration: boolean;
    stats?: any;
  } {
    const dbPath = join(this.storageRoot, "rules", "rules.db");
    const hasSQLite = existsSync(dbPath);
    const hasLegacy = existsSync(this.indexPath);

    let stats = undefined;
    if (hasSQLite) {
      const storage = new RuleStorageSQLite();
      stats = storage.getStats();
      storage.close();
    }

    return {
      hasSQLite,
      hasLegacy,
      needsMigration: this.needsMigration(),
      stats
    };
  }
}

// CLI interface for manual migration
// Check if this file is being run directly (ES module equivalent of require.main === module)
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (import.meta.url === `file://${process.argv[1]}`) {
  const migration = new SQLiteMigration();

  const command = process.argv[2];

  switch (command) {
    case "status":
      console.log(JSON.stringify(migration.getStatus(), null, 2));
      break;

    case "migrate":
      migration.migrate().then(result => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.success ? 0 : 1);
      });
      break;

    case "rollback":
      const success = migration.rollback();
      console.log(success ? "Rollback successful" : "Rollback failed");
      process.exit(success ? 0 : 1);
      break;

    default:
      console.log("Usage: node migrate-to-sqlite.js [status|migrate|rollback]");
      process.exit(1);
  }
}
