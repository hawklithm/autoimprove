/**
 * SQLite-based Rule Storage
 *
 * Provides enhanced querying capabilities over the legacy JSON-based storage:
 * - Full-text search (FTS5)
 * - Scene-based indexing
 * - Keyword segment matching
 * - Better concurrency and performance
 */

import Database from "better-sqlite3";
import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { RuleIndexEntry, RuleContent, Scene, RuleScope, createScene } from "../core/models.js";
import { logger } from "../core/logger.js";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class RuleStorageSQLite {
  private db: Database.Database;
  private dbPath: string;

  constructor() {
    const storageRoot = process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
    const dbDir = join(storageRoot, "rules");

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = join(dbDir, "rules.db");
    this.db = new Database(this.dbPath);
    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    // Load schema
    const schemaPath = join(__dirname, 'rule-storage-schema.sql');
    if (existsSync(schemaPath)) {
      const schema = readFileSync(schemaPath, 'utf-8');
      this.db.exec(schema);
      logger.info("rule-storage-sqlite", "Database schema initialized");
    } else {
      logger.warn("rule-storage-sqlite", "Schema file not found, database may not be properly initialized");
    }
  }

  /**
   * Add a rule to the database
   */
  addRule(entry: RuleIndexEntry, content: RuleContent): void {
    const tx = this.db.transaction(() => {
      // Insert rule metadata
      this.db.prepare(`
        INSERT INTO rules (
          id, type, priority, confidence,
          tech_scene, functional_scene, business_scene,
          scope, scope_project_path, scope_organization_id,
          keywords, created_at, updated_at, content_file
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.id,
        entry.type,
        entry.priority,
        entry.confidence,
        JSON.stringify(entry.scenes?.tech || []),
        JSON.stringify(entry.scenes?.functional || []),
        JSON.stringify(entry.scenes?.business || []),
        entry.scope || RuleScope.GLOBAL,
        entry.scope_context?.project_path || null,
        entry.scope_context?.organization_id || null,
        JSON.stringify(entry.keywords),
        entry.created_at,
        entry.updated_at,
        `${entry.id}.md`
      );

      // Insert FTS entry
      this.insertFTSEntry(entry.id, content);

      // Insert scene index entries
      this.insertSceneIndex(entry.id, entry.scenes);

      // Insert keyword segments
      this.insertKeywordSegments(entry.id, entry, content);
    });

    tx();
  }

  /**
   * Insert FTS entry for full-text search
   */
  private insertFTSEntry(ruleId: string, content: RuleContent): void {
    // Safely handle keywords - ensure it's an array
    let keywordsStr = '';
    if (content.metadata?.keywords) {
      if (Array.isArray(content.metadata.keywords)) {
        keywordsStr = content.metadata.keywords.join(' ');
      } else if (typeof content.metadata.keywords === 'string') {
        keywordsStr = content.metadata.keywords;
      }
    }

    this.db.prepare(`
      INSERT INTO rules_fts (rule_id, title, description, how_to_apply, when_to_use, exceptions, keywords)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      ruleId,
      content.title || '',
      content.description || '',
      content.how_to_apply || '',
      content.when_to_use || '',
      content.exceptions || '',
      keywordsStr
    );
  }

  /**
   * Insert scene index entries for fast scene-based filtering
   */
  private insertSceneIndex(ruleId: string, scenes?: Scene): void {
    if (!scenes) return;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO scene_index (scene_dimension, scene_value, rule_id)
      VALUES (?, ?, ?)
    `);

    for (const tech of scenes.tech) {
      stmt.run('tech', tech.toLowerCase(), ruleId);
    }

    for (const functional of scenes.functional) {
      stmt.run('functional', functional.toLowerCase(), ruleId);
    }

    for (const business of scenes.business) {
      stmt.run('business', business.toLowerCase(), ruleId);
    }
  }

  /**
   * Insert keyword segments for fuzzy matching
   */
  private insertKeywordSegments(ruleId: string, entry: RuleIndexEntry, content: RuleContent): void {
    const segments = new Set<string>();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO keyword_segments (segment, rule_id, source)
      VALUES (?, ?, ?)
    `);

    // From rule ID
    const idParts = entry.id.split('-').filter(p => p !== 'rule');
    for (const part of idParts) {
      const segs = this.splitToken(part);
      segs.forEach(seg => segments.add(seg.toLowerCase()));
    }

    idParts.forEach(part => {
      this.splitToken(part).forEach(seg => {
        stmt.run(seg.toLowerCase(), ruleId, 'id');
      });
    });

    // From keywords
    for (const keyword of entry.keywords) {
      this.splitToken(keyword).forEach(seg => {
        stmt.run(seg.toLowerCase(), ruleId, 'keyword');
      });
    }

    // From title
    if (content.title) {
      this.splitToken(content.title).forEach(seg => {
        stmt.run(seg.toLowerCase(), ruleId, 'title');
      });
    }

    // From description (first 100 chars)
    if (content.description) {
      const shortDesc = content.description.substring(0, 100);
      this.splitToken(shortDesc).forEach(seg => {
        if (seg.length >= 3) {  // Only meaningful segments
          stmt.run(seg.toLowerCase(), ruleId, 'description');
        }
      });
    }
  }

  /**
   * Split token into segments (camelCase, snake_case, kebab-case)
   */
  private splitToken(text: string): string[] {
    const segments: string[] = [];
    const words = text.split(/[_\-\s]+/);

    for (const word of words) {
      // Split camelCase
      const camelSegments = word.split(/(?=[A-Z])/).filter(s => s.length > 0);
      segments.push(...camelSegments);
    }

    return segments.filter(s => s.length > 1);
  }

  /**
   * Get rule by ID
   */
  getRule(ruleId: string): RuleIndexEntry | null {
    const row = this.db.prepare(`
      SELECT * FROM rules WHERE id = ?
    `).get(ruleId) as any;

    if (!row) return null;

    return this.rowToRuleEntry(row);
  }

  /**
   * Search rules by full-text query
   */
  searchFullText(query: string, limit: number = 10): RuleIndexEntry[] {
    const rows = this.db.prepare(`
      SELECT r.*, rf.rank
      FROM rules r
      JOIN rules_fts rf ON r.id = rf.rule_id
      WHERE rules_fts MATCH ?
      ORDER BY rf.rank, r.confidence DESC
      LIMIT ?
    `).all(query, limit) as any[];

    return rows.map(row => this.rowToRuleEntry(row));
  }

  /**
   * Search rules by scene
   */
  searchByScene(scene: Scene, limit: number = 10): RuleIndexEntry[] {
    const allSceneTerms = [
      ...scene.tech.map(t => ({ dimension: 'tech', value: t })),
      ...scene.functional.map(f => ({ dimension: 'functional', value: f })),
      ...scene.business.map(b => ({ dimension: 'business', value: b }))
    ];

    if (allSceneTerms.length === 0) {
      return this.listAllRules(limit);
    }

    // Build dynamic query
    const placeholders = allSceneTerms.map(() => '(scene_dimension = ? AND scene_value = ?)').join(' OR ');

    const query = `
      SELECT r.*, COUNT(DISTINCT si.scene_value) as match_count
      FROM rules r
      JOIN scene_index si ON r.id = si.rule_id
      WHERE ${placeholders}
      GROUP BY r.id
      ORDER BY match_count DESC, r.confidence DESC
      LIMIT ?
    `;

    const params: any[] = allSceneTerms.flatMap(t => [t.dimension, t.value.toLowerCase()]);
    params.push(limit);

    const rows = this.db.prepare(query).all(params) as any[];

    return rows.map(row => this.rowToRuleEntry(row));
  }

  /**
   * Search rules by keyword segments
   */
  searchByKeywords(keywords: string[], limit: number = 10): RuleIndexEntry[] {
    if (keywords.length === 0) {
      return [];
    }

    const segments = keywords.flatMap(kw => this.splitToken(kw));
    const placeholders = segments.map(() => '?').join(',');

    const query = `
      SELECT DISTINCT r.*, COUNT(DISTINCT ks.segment) as match_count
      FROM rules r
      JOIN keyword_segments ks ON r.id = ks.rule_id
      WHERE ks.segment IN (${placeholders})
      GROUP BY r.id
      ORDER BY match_count DESC, r.confidence DESC
      LIMIT ?
    `;

    const params = [...segments.map(s => s.toLowerCase()), limit];
    const rows = this.db.prepare(query).all(params) as any[];

    return rows.map(row => this.rowToRuleEntry(row));
  }

  /**
   * List all rules
   */
  listAllRules(limit?: number): RuleIndexEntry[] {
    const query = limit
      ? `SELECT * FROM rules ORDER BY confidence DESC, priority LIMIT ?`
      : `SELECT * FROM rules ORDER BY confidence DESC, priority`;

    const rows = limit
      ? this.db.prepare(query).all(limit)
      : this.db.prepare(query).all();

    return (rows as any[]).map(row => this.rowToRuleEntry(row));
  }

  /**
   * Update rule (with transaction)
   */
  updateRule(ruleId: string, updates: Partial<RuleIndexEntry>): void {
    const tx = this.db.transaction(() => {
      const fields: string[] = [];
      const values: any[] = [];

      if (updates.type !== undefined) {
        fields.push('type = ?');
        values.push(updates.type);
      }

      if (updates.priority !== undefined) {
        fields.push('priority = ?');
        values.push(updates.priority);
      }

      if (updates.confidence !== undefined) {
        fields.push('confidence = ?');
        values.push(updates.confidence);
      }

      if (updates.scenes !== undefined) {
        fields.push('tech_scene = ?', 'functional_scene = ?', 'business_scene = ?');
        values.push(
          JSON.stringify(updates.scenes.tech),
          JSON.stringify(updates.scenes.functional),
          JSON.stringify(updates.scenes.business)
        );
      }

      if (updates.keywords !== undefined) {
        fields.push('keywords = ?');
        values.push(JSON.stringify(updates.keywords));
      }

      fields.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(ruleId);

      // Update main table
      const query = `UPDATE rules SET ${fields.join(', ')} WHERE id = ?`;
      this.db.prepare(query).run(...values);

      // Update scene index if scenes changed
      if (updates.scenes !== undefined) {
        this.db.prepare('DELETE FROM scene_index WHERE rule_id = ?').run(ruleId);
        this.insertSceneIndex(ruleId, updates.scenes);
      }

      // Update keyword segments if keywords changed
      if (updates.keywords !== undefined) {
        this.db.prepare('DELETE FROM keyword_segments WHERE rule_id = ?').run(ruleId);
        // Re-insert segments for new keywords
        const stmt = this.db.prepare('INSERT OR IGNORE INTO keyword_segments (segment, rule_id, source) VALUES (?, ?, ?)');
        for (const keyword of updates.keywords) {
          this.splitToken(keyword).forEach(seg => {
            stmt.run(seg.toLowerCase(), ruleId, 'keyword');
          });
        }
      }
    });

    tx();
  }

  /**
   * Delete rule (with transaction)
   */
  deleteRule(ruleId: string): void {
    const tx = this.db.transaction(() => {
      // Delete in reverse dependency order to avoid foreign key issues
      this.db.prepare('DELETE FROM keyword_segments WHERE rule_id = ?').run(ruleId);
      this.db.prepare('DELETE FROM scene_index WHERE rule_id = ?').run(ruleId);
      this.db.prepare('DELETE FROM rules_fts WHERE rule_id = ?').run(ruleId);
      this.db.prepare('DELETE FROM rules WHERE id = ?').run(ruleId);
    });

    tx();
  }

  /**
   * Convert database row to RuleIndexEntry
   */
  private rowToRuleEntry(row: any): RuleIndexEntry {
    return {
      id: row.id,
      type: row.type,
      priority: row.priority,
      confidence: row.confidence,
      scenes: createScene({
        tech: JSON.parse(row.tech_scene || '[]'),
        functional: JSON.parse(row.functional_scene || '[]'),
        business: JSON.parse(row.business_scene || '[]')
      }),
      scope: row.scope as RuleScope,
      scope_context: {
        project_path: row.scope_project_path,
        organization_id: row.scope_organization_id
      },
      keywords: JSON.parse(row.keywords || '[]'),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * Get database statistics
   */
  getStats() {
    const ruleCount = this.db.prepare('SELECT COUNT(*) as count FROM rules').get() as any;
    const sceneCount = this.db.prepare('SELECT COUNT(*) as count FROM scene_index').get() as any;
    const segmentCount = this.db.prepare('SELECT COUNT(DISTINCT segment) as count FROM keyword_segments').get() as any;

    return {
      total_rules: ruleCount.count,
      total_scene_entries: sceneCount.count,
      unique_segments: segmentCount.count,
      db_path: this.dbPath
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Health check for database integrity
   */
  healthCheck(): {
    healthy: boolean;
    issues: string[];
    stats: any;
  } {
    const issues: string[] = [];

    try {
      // 1. Integrity check
      const integrityResult = this.db.pragma('integrity_check', { simple: true });
      if (integrityResult !== 'ok') {
        issues.push(`Database integrity check failed: ${integrityResult}`);
      }
    } catch (error) {
      issues.push(`Integrity check error: ${error}`);
    }

    // 2. FTS5 index validation
    try {
      this.db.prepare('SELECT COUNT(*) FROM rules_fts').get();
    } catch (error) {
      issues.push('FTS5 index corrupted');
    }

    // 3. Count consistency check
    try {
      const ruleCount = this.db.prepare('SELECT COUNT(*) as c FROM rules').get() as any;
      const ftsCount = this.db.prepare('SELECT COUNT(*) as c FROM rules_fts').get() as any;
      if (ruleCount.c !== ftsCount.c) {
        issues.push(`Count mismatch: ${ruleCount.c} rules but ${ftsCount.c} FTS entries`);
      }
    } catch (error) {
      issues.push(`Count check error: ${error}`);
    }

    const stats = this.getStats();

    return {
      healthy: issues.length === 0,
      issues,
      stats
    };
  }

  /**
   * Database maintenance operations
   */
  maintenance(): void {
    logger.info("rule-storage-sqlite", "Running database maintenance");

    try {
      // Optimize query planner
      this.db.pragma('optimize');
      this.db.pragma('analysis_limit=1000');
      this.db.pragma('analyze');

      // Checkpoint WAL if needed
      const walCheckpoint = this.db.pragma('wal_checkpoint(PASSIVE)', { simple: true }) as any;
      if (walCheckpoint) {
        logger.info("rule-storage-sqlite", `WAL checkpoint completed`);
      }

      // Check for fragmentation
      const pageCount = this.db.pragma('page_count', { simple: true }) as number;
      const freelistCount = this.db.pragma('freelist_count', { simple: true }) as number;

      if (freelistCount > pageCount * 0.3) {
        logger.info("rule-storage-sqlite", `Database fragmented (${freelistCount} free pages of ${pageCount}), running VACUUM`);
        this.db.prepare('VACUUM').run();
      }

      logger.info("rule-storage-sqlite", "Maintenance completed successfully");
    } catch (error) {
      logger.error("rule-storage-sqlite", "Maintenance error", error as Error);
    }
  }
}
