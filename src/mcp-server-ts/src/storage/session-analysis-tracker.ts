/**
 * Session Analysis Tracker
 *
 * Tracks which sessions have been analyzed to avoid redundant processing.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface SessionAnalysisRecord {
  session_id: string;
  session_file_path: string;
  analyzed_at: string;
  file_mtime: number; // File modification time in milliseconds
  file_size: number; // File size in bytes for quick change detection
  patterns_found: number;
  rules_generated: number;
  analysis_mode: "standard" | "consolidated";
  success: boolean;
  error_message?: string;
  incremental_analysis?: boolean; // True if this was an incremental update
  previous_patterns?: number; // Patterns from previous analysis (for incremental)
  previous_rules?: number; // Rules from previous analysis (for incremental)
}

export interface AnalysisTrackerState {
  version: string;
  last_updated: string;
  analyzed_sessions: Record<string, SessionAnalysisRecord>;
  total_analyzed: number;
  total_patterns: number;
  total_rules: number;
}

export class SessionAnalysisTracker {
  private stateFilePath: string;
  private state: AnalysisTrackerState;

  constructor() {
    const storageRoot = process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
    this.stateFilePath = join(storageRoot, "analyzed_sessions.json");
    this.state = this.loadState();
  }

  private loadState(): AnalysisTrackerState {
    if (!existsSync(this.stateFilePath)) {
      return {
        version: "1.0",
        last_updated: new Date().toISOString(),
        analyzed_sessions: {},
        total_analyzed: 0,
        total_patterns: 0,
        total_rules: 0,
      };
    }

    try {
      const data = readFileSync(this.stateFilePath, "utf-8");
      return JSON.parse(data) as AnalysisTrackerState;
    } catch (error) {
      console.error("Failed to load analysis tracker state, creating new:", error);
      return {
        version: "1.0",
        last_updated: new Date().toISOString(),
        analyzed_sessions: {},
        total_analyzed: 0,
        total_patterns: 0,
        total_rules: 0,
      };
    }
  }

  private saveState(): void {
    this.state.last_updated = new Date().toISOString();

    // Write to temp file first for atomic operation
    const tempPath = this.stateFilePath + ".tmp";
    writeFileSync(tempPath, JSON.stringify(this.state, null, 2));

    // Atomic rename
    renameSync(tempPath, this.stateFilePath);
  }

  /**
   * Check if a session needs re-analysis based on file modification time
   * Returns: { needsAnalysis: boolean, reason: string, isIncremental: boolean }
   */
  checkIfNeedsAnalysis(sessionId: string, currentMtime: number, currentSize: number): {
    needsAnalysis: boolean;
    reason: string;
    isIncremental: boolean;
  } {
    const record = this.getRecord(sessionId);

    if (!record) {
      return {
        needsAnalysis: true,
        reason: "never_analyzed",
        isIncremental: false,
      };
    }

    if (!record.success) {
      return {
        needsAnalysis: true,
        reason: "previous_failed",
        isIncremental: false,
      };
    }

    // Check if file has been modified since last analysis
    if (currentMtime > record.file_mtime) {
      return {
        needsAnalysis: true,
        reason: "file_updated",
        isIncremental: true,
      };
    }

    // Also check file size as a quick change detector
    if (currentSize !== record.file_size) {
      return {
        needsAnalysis: true,
        reason: "file_size_changed",
        isIncremental: true,
      };
    }

    return {
      needsAnalysis: false,
      reason: "up_to_date",
      isIncremental: false,
    };
  }

  /**
   * Check if a session has been analyzed (legacy method for compatibility)
   */
  isAnalyzed(sessionId: string): boolean {
    return sessionId in this.state.analyzed_sessions;
  }

  /**
   * Get the last analysis timestamp for incremental analysis
   */
  getLastAnalysisTime(sessionId: string): string | null {
    const record = this.getRecord(sessionId);
    return record ? record.analyzed_at : null;
  }

  /**
   * Mark a session as analyzed
   */
  markAnalyzed(record: SessionAnalysisRecord): void {
    this.state.analyzed_sessions[record.session_id] = record;
    this.state.total_analyzed = Object.keys(this.state.analyzed_sessions).length;

    // Update totals if successful
    if (record.success) {
      this.state.total_patterns += record.patterns_found;
      this.state.total_rules += record.rules_generated;
    }

    this.saveState();
  }

  /**
   * Get analysis record for a session
   */
  getRecord(sessionId: string): SessionAnalysisRecord | null {
    return this.state.analyzed_sessions[sessionId] || null;
  }

  /**
   * Get all analyzed sessions
   */
  getAllRecords(): SessionAnalysisRecord[] {
    return Object.values(this.state.analyzed_sessions).sort(
      (a, b) => b.analyzed_at.localeCompare(a.analyzed_at)
    );
  }

  /**
   * Get summary statistics
   */
  getStats(): {
    total_analyzed: number;
    total_patterns: number;
    total_rules: number;
    success_rate: number;
    last_analyzed?: SessionAnalysisRecord;
  } {
    const records = this.getAllRecords();
    const successful = records.filter((r) => r.success).length;
    const successRate = records.length > 0 ? successful / records.length : 0;

    return {
      total_analyzed: this.state.total_analyzed,
      total_patterns: this.state.total_patterns,
      total_rules: this.state.total_rules,
      success_rate: successRate,
      last_analyzed: records[0] || undefined,
    };
  }

  /**
   * Filter sessions to find unanalyzed ones
   */
  filterUnanalyzed(sessionIds: string[]): string[] {
    return sessionIds.filter((id) => !this.isAnalyzed(id));
  }

  /**
   * Clear a specific session record (for re-analysis)
   */
  clearRecord(sessionId: string): boolean {
    if (sessionId in this.state.analyzed_sessions) {
      const record = this.state.analyzed_sessions[sessionId];
      delete this.state.analyzed_sessions[sessionId];

      // Update totals
      this.state.total_analyzed = Object.keys(this.state.analyzed_sessions).length;
      if (record.success) {
        this.state.total_patterns = Math.max(0, this.state.total_patterns - record.patterns_found);
        this.state.total_rules = Math.max(0, this.state.total_rules - record.rules_generated);
      }

      this.saveState();
      return true;
    }
    return false;
  }

  /**
   * Clear all records (reset tracker)
   */
  clearAll(): void {
    this.state = {
      version: "1.0",
      last_updated: new Date().toISOString(),
      analyzed_sessions: {},
      total_analyzed: 0,
      total_patterns: 0,
      total_rules: 0,
    };
    this.saveState();
  }

  /**
   * Get full state (for inspection/debugging)
   */
  getState(): AnalysisTrackerState {
    return { ...this.state };
  }
}
