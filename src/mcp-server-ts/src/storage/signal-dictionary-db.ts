/**
 * SQLite-based signal dictionary storage
 */

import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { logger } from "./../core/logger.js";

export interface SignalEntry {
  id?: number;
  text: string;
  language: "zh" | "en" | "mixed";
  pattern_type: "correction" | "anti-pattern" | "preference" | "performance" | "security";
  polarity: "positive" | "negative" | "neutral";
  confidence: number;
  typical_context: string[]; // JSON array
  related_signals: string[]; // JSON array
  match_count: number;
  true_positive: number;
  false_positive: number;
  first_seen: string;
  last_seen: string;
  source: "seed" | "llm_extracted" | "user_added";
  created_at: string;
  updated_at: string;
}

export interface ConfidenceHistory {
  id?: number;
  signal_id: number;
  timestamp: string;
  old_confidence: number;
  new_confidence: number;
  reason: "bayesian_update" | "feedback" | "co_occurrence" | "time_decay";
  evidence: string; // JSON object
}

export interface LabeledContent {
  id?: number;
  message_id: string;
  session_id: string;
  content: string;
  matched_signals: string; // JSON array of {signal_text, position, confidence, contribution_weight}
  pattern_type: string;
  confidence: number;
  before_content?: string;
  after_content?: string;
  related_tool_calls?: string; // JSON array
  labeled_at: string;
  labeling_method: "dictionary" | "llm";
}

export interface SignalMatch {
  id?: number;
  signal_id: number;
  session_id: string;
  message_id: string;
  matched_at: string;
  context_window: string;
  outcome?: "true_positive" | "false_positive" | "uncertain";
}

export class SignalDictionaryDB {
  private db: Database.Database;
  private dbPath: string;

  constructor() {
    const storageRoot = process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
    const dbDir = join(storageRoot, "signal_dictionary");

    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = join(dbDir, "signals.db");
    this.db = new Database(this.dbPath);
    this.initializeSchema();
  }

  private initializeSchema() {
    // Signals table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL UNIQUE,
        language TEXT NOT NULL CHECK(language IN ('zh', 'en', 'mixed')),
        pattern_type TEXT NOT NULL CHECK(pattern_type IN ('correction', 'anti-pattern', 'preference', 'performance', 'security')),
        polarity TEXT NOT NULL CHECK(polarity IN ('positive', 'negative', 'neutral')),
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        typical_context TEXT NOT NULL DEFAULT '[]',
        related_signals TEXT NOT NULL DEFAULT '[]',
        match_count INTEGER NOT NULL DEFAULT 0,
        true_positive INTEGER NOT NULL DEFAULT 0,
        false_positive INTEGER NOT NULL DEFAULT 0,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('seed', 'llm_extracted', 'user_added')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_signals_text ON signals(text);
      CREATE INDEX IF NOT EXISTS idx_signals_pattern_type ON signals(pattern_type);
      CREATE INDEX IF NOT EXISTS idx_signals_confidence ON signals(confidence DESC);
    `);

    // Confidence history table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS confidence_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        old_confidence REAL NOT NULL,
        new_confidence REAL NOT NULL,
        reason TEXT NOT NULL CHECK(reason IN ('bayesian_update', 'feedback', 'co_occurrence', 'time_decay')),
        evidence TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_confidence_history_signal ON confidence_history(signal_id);
      CREATE INDEX IF NOT EXISTS idx_confidence_history_timestamp ON confidence_history(timestamp DESC);
    `);

    // Labeled content table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS labeled_content (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        matched_signals TEXT NOT NULL,
        pattern_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        before_content TEXT,
        after_content TEXT,
        related_tool_calls TEXT,
        labeled_at TEXT NOT NULL,
        labeling_method TEXT NOT NULL CHECK(labeling_method IN ('dictionary', 'llm'))
      );

      CREATE INDEX IF NOT EXISTS idx_labeled_content_session ON labeled_content(session_id);
      CREATE INDEX IF NOT EXISTS idx_labeled_content_pattern ON labeled_content(pattern_type);
      CREATE INDEX IF NOT EXISTS idx_labeled_content_confidence ON labeled_content(confidence DESC);
    `);

    // Signal matches table (for tracking outcomes)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS signal_matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        matched_at TEXT NOT NULL,
        context_window TEXT NOT NULL,
        outcome TEXT CHECK(outcome IN ('true_positive', 'false_positive', 'uncertain')),
        FOREIGN KEY (signal_id) REFERENCES signals(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_signal_matches_signal ON signal_matches(signal_id);
      CREATE INDEX IF NOT EXISTS idx_signal_matches_session ON signal_matches(session_id);
    `);

    logger.info("signal-dictionary", "Database schema initialized");
  }

  // ============================================================================
  // Signal CRUD operations
  // ============================================================================

  addSignal(signal: Omit<SignalEntry, "id">): number {
    const stmt = this.db.prepare(`
      INSERT INTO signals (
        text, language, pattern_type, polarity, confidence,
        typical_context, related_signals, match_count, true_positive, false_positive,
        first_seen, last_seen, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      signal.text,
      signal.language,
      signal.pattern_type,
      signal.polarity,
      signal.confidence,
      JSON.stringify(signal.typical_context),
      JSON.stringify(signal.related_signals),
      signal.match_count,
      signal.true_positive,
      signal.false_positive,
      signal.first_seen,
      signal.last_seen,
      signal.source,
      signal.created_at,
      signal.updated_at
    );

    return result.lastInsertRowid as number;
  }

  getSignalByText(text: string): SignalEntry | undefined {
    const stmt = this.db.prepare(`SELECT * FROM signals WHERE text = ?`);
    const row = stmt.get(text) as any;

    if (!row) return undefined;

    return this.parseSignalRow(row);
  }

  getSignalById(id: number): SignalEntry | undefined {
    const stmt = this.db.prepare(`SELECT * FROM signals WHERE id = ?`);
    const row = stmt.get(id) as any;

    if (!row) return undefined;

    return this.parseSignalRow(row);
  }

  getAllSignals(options: {
    pattern_type?: string;
    min_confidence?: number;
    limit?: number;
  } = {}): SignalEntry[] {
    let query = `SELECT * FROM signals WHERE 1=1`;
    const params: any[] = [];

    if (options.pattern_type) {
      query += ` AND pattern_type = ?`;
      params.push(options.pattern_type);
    }

    if (options.min_confidence !== undefined) {
      query += ` AND confidence >= ?`;
      params.push(options.min_confidence);
    }

    query += ` ORDER BY confidence DESC`;

    if (options.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => this.parseSignalRow(row));
  }

  updateSignalConfidence(signalId: number, newConfidence: number, reason: string, evidence: any) {
    const signal = this.getSignalById(signalId);
    if (!signal) {
      throw new Error(`Signal ${signalId} not found`);
    }

    const now = new Date().toISOString();

    // Update signal
    const updateStmt = this.db.prepare(`
      UPDATE signals
      SET confidence = ?, updated_at = ?
      WHERE id = ?
    `);
    updateStmt.run(newConfidence, now, signalId);

    // Record history
    const historyStmt = this.db.prepare(`
      INSERT INTO confidence_history (signal_id, timestamp, old_confidence, new_confidence, reason, evidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    historyStmt.run(
      signalId,
      now,
      signal.confidence,
      newConfidence,
      reason,
      JSON.stringify(evidence)
    );
  }

  incrementMatchCount(signalId: number) {
    const stmt = this.db.prepare(`
      UPDATE signals
      SET match_count = match_count + 1, last_seen = ?, updated_at = ?
      WHERE id = ?
    `);
    const now = new Date().toISOString();
    stmt.run(now, now, signalId);
  }

  recordMatchOutcome(signalId: number, outcome: "true_positive" | "false_positive") {
    const column = outcome === "true_positive" ? "true_positive" : "false_positive";
    const stmt = this.db.prepare(`
      UPDATE signals
      SET ${column} = ${column} + 1, updated_at = ?
      WHERE id = ?
    `);
    const now = new Date().toISOString();
    stmt.run(now, signalId);
  }

  // ============================================================================
  // Confidence history
  // ============================================================================

  getConfidenceHistory(signalId: number, limit: number = 10): ConfidenceHistory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM confidence_history
      WHERE signal_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    const rows = stmt.all(signalId, limit) as any[];

    return rows.map(row => ({
      ...row,
      evidence: JSON.parse(row.evidence)
    }));
  }

  // ============================================================================
  // Labeled content
  // ============================================================================

  /**
   * Validate content before storage to prevent system metadata pollution
   */
  private validateContent(content: string): { valid: boolean; reason?: string } {
    // Reject content with system metadata patterns
    const systemPatterns = [
      { pattern: /^Base directory for this skill:/i, reason: 'Contains skill system metadata' },
      { pattern: /^<command-/i, reason: 'Contains command tag metadata' },
      { pattern: /\/Users\/[^\/]+\/\.claude\//i, reason: 'Contains local .claude path' },
      { pattern: /^\/Users\/[^\/]+\/\.config\//i, reason: 'Contains local config path' },
    ];

    for (const { pattern, reason } of systemPatterns) {
      if (pattern.test(content)) {
        return { valid: false, reason };
      }
    }

    return { valid: true };
  }

  saveLabeledContent(content: Omit<LabeledContent, "id">): number {
    // Validate content before storing
    const validation = this.validateContent(content.content);
    if (!validation.valid) {
      logger.warn('signal-db', `Rejecting labeled content: ${validation.reason}`, {
        session_id: content.session_id,
        content_preview: content.content.substring(0, 100)
      });
      throw new Error(`Invalid content: ${validation.reason}`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO labeled_content (
        message_id, session_id, content, matched_signals, pattern_type,
        confidence, before_content, after_content, related_tool_calls,
        labeled_at, labeling_method
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      content.message_id,
      content.session_id,
      content.content,
      content.matched_signals,
      content.pattern_type,
      content.confidence,
      content.before_content || null,
      content.after_content || null,
      content.related_tool_calls || null,
      content.labeled_at,
      content.labeling_method
    );

    return result.lastInsertRowid as number;
  }

  getLabeledContentBySession(sessionId: string): LabeledContent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM labeled_content
      WHERE session_id = ?
      ORDER BY labeled_at ASC
    `);
    const rows = stmt.all(sessionId) as any[];

    return rows.map(row => ({
      ...row,
      matched_signals: JSON.parse(row.matched_signals),
      related_tool_calls: row.related_tool_calls ? JSON.parse(row.related_tool_calls) : undefined
    }));
  }

  getLabeledContentByPatternType(patternType: string): LabeledContent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM labeled_content
      WHERE pattern_type = ?
      ORDER BY confidence DESC
    `);
    const rows = stmt.all(patternType) as any[];

    return rows.map(row => ({
      ...row,
      matched_signals: JSON.parse(row.matched_signals),
      related_tool_calls: row.related_tool_calls ? JSON.parse(row.related_tool_calls) : undefined
    }));
  }

  // ============================================================================
  // Signal matches
  // ============================================================================

  recordSignalMatch(match: Omit<SignalMatch, "id">): number {
    const stmt = this.db.prepare(`
      INSERT INTO signal_matches (signal_id, session_id, message_id, matched_at, context_window, outcome)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      match.signal_id,
      match.session_id,
      match.message_id,
      match.matched_at,
      match.context_window,
      match.outcome || null
    );

    return result.lastInsertRowid as number;
  }

  updateMatchOutcome(matchId: number, outcome: "true_positive" | "false_positive" | "uncertain") {
    const stmt = this.db.prepare(`
      UPDATE signal_matches
      SET outcome = ?
      WHERE id = ?
    `);
    stmt.run(outcome, matchId);
  }

  getSignalMatches(signalId: number, limit: number = 50): SignalMatch[] {
    const stmt = this.db.prepare(`
      SELECT * FROM signal_matches
      WHERE signal_id = ?
      ORDER BY matched_at DESC
      LIMIT ?
    `);
    return stmt.all(signalId, limit) as SignalMatch[];
  }

  /**
   * Return the distinct signal texts matched within a session. Used by
   * per-user personalization (F3) to fold a session's positive signals into a
   * user centroid. Reuses the existing signal_matches + signals tables.
   */
  getSignalTextsBySession(sessionId: string): string[] {
    const stmt = this.db.prepare(`
      SELECT DISTINCT s.text FROM signal_matches sm
      JOIN signals s ON s.id = sm.signal_id
      WHERE sm.session_id = ?
    `);
    return (stmt.all(sessionId) as Array<{ text: string }>).map(r => r.text).filter(Boolean);
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  getDictionaryStats() {
    const totalSignals = this.db.prepare(`SELECT COUNT(*) as count FROM signals`).get() as any;
    const byType = this.db.prepare(`
      SELECT pattern_type, COUNT(*) as count
      FROM signals
      GROUP BY pattern_type
    `).all() as any[];

    const bySource = this.db.prepare(`
      SELECT source, COUNT(*) as count
      FROM signals
      GROUP BY source
    `).all() as any[];

    const avgConfidence = this.db.prepare(`
      SELECT AVG(confidence) as avg FROM signals
    `).get() as any;

    const totalMatches = this.db.prepare(`
      SELECT SUM(match_count) as total FROM signals
    `).get() as any;

    const labeledCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM labeled_content
    `).get() as any;

    return {
      total_signals: totalSignals.count,
      by_type: byType,
      by_source: bySource,
      avg_confidence: avgConfidence.avg,
      total_matches: totalMatches.total || 0,
      labeled_content_count: labeledCount.count
    };
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  private parseSignalRow(row: any): SignalEntry {
    return {
      ...row,
      typical_context: JSON.parse(row.typical_context),
      related_signals: JSON.parse(row.related_signals)
    };
  }

  close() {
    this.db.close();
  }

  // ============================================================================
  // Batch operations for seed data
  // ============================================================================

  batchInsertSignals(signals: Omit<SignalEntry, "id">[]) {
    const insert = this.db.prepare(`
      INSERT INTO signals (
        text, language, pattern_type, polarity, confidence,
        typical_context, related_signals, match_count, true_positive, false_positive,
        first_seen, last_seen, source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((signals: Omit<SignalEntry, "id">[]) => {
      for (const signal of signals) {
        insert.run(
          signal.text,
          signal.language,
          signal.pattern_type,
          signal.polarity,
          signal.confidence,
          JSON.stringify(signal.typical_context),
          JSON.stringify(signal.related_signals),
          signal.match_count,
          signal.true_positive,
          signal.false_positive,
          signal.first_seen,
          signal.last_seen,
          signal.source,
          signal.created_at,
          signal.updated_at
        );
      }
    });

    insertMany(signals);
  }
}
