/**
 * Session analysis cache manager.
 *
 * Tracks which sessions have been analyzed and caches results
 * to support incremental analysis.
 */

import { join } from "path";
import { existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { createHash } from "crypto";
import { CACHE_DIR } from "./init.js";
import { Pattern } from "../core/models.js";

export interface SessionCacheEntry {
  session_id: string;
  session_file: string;
  content_hash?: string;  // NEW: SHA256 hash for content verification
  last_analyzed_at: string;
  last_line_analyzed: number;
  file_size_at_analysis: number;
  patterns_found: number;
  cached_patterns: Pattern[];
  pattern_fingerprints?: string[];  // NEW: Link to pattern evolution
}

export interface SessionCacheIndex {
  version: string;
  sessions: Record<string, SessionCacheEntry>;
}

const CACHE_INDEX_PATH = join(CACHE_DIR, "session-analysis.json");

export class SessionCacheManager {
  private index: SessionCacheIndex;

  constructor() {
    this.index = this.loadIndex();
  }

  /**
   * Check if a session has been analyzed before
   */
  hasAnalyzed(sessionId: string): boolean {
    return sessionId in this.index.sessions;
  }

  /**
   * Get cached analysis for a session
   */
  getCached(sessionId: string): SessionCacheEntry | null {
    return this.index.sessions[sessionId] || null;
  }

  /**
   * Compute SHA256 hash of file content
   */
  computeFileHash(filePath: string): string | null {
    try {
      if (!existsSync(filePath)) return null;

      const content = readFileSync(filePath, "utf-8");
      const hash = createHash('sha256').update(content).digest('hex');

      return `sha256:${hash}`;
    } catch (error) {
      // console.error(`Failed to compute hash for ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Check if session file has changed since last analysis (using content hash)
   */
  hasSessionChanged(sessionFile: string, sessionId: string): boolean {
    const cached = this.getCached(sessionId);
    if (!cached) return true;

    if (!existsSync(sessionFile)) return false;

    // Use content hash if available (most accurate)
    if (cached.content_hash) {
      const currentHash = this.computeFileHash(sessionFile);
      if (currentHash && currentHash !== cached.content_hash) {
        return true;
      }
      // Hash match = no change
      if (currentHash === cached.content_hash) {
        return false;
      }
    }

    // Fallback to file size comparison (legacy)
    const stats = statSync(sessionFile);
    const currentSize = stats.size;

    return currentSize !== cached.file_size_at_analysis;
  }

  /**
   * Get the line number where to resume analysis
   */
  getResumePoint(sessionId: string): number {
    const cached = this.getCached(sessionId);
    return cached ? cached.last_line_analyzed : 0;
  }

  /**
   * Save analysis results to cache
   */
  saveAnalysis(
    sessionId: string,
    sessionFile: string,
    lastLine: number,
    fileSize: number,
    patterns: Pattern[],
    patternFingerprints?: string[]
  ): void {
    // Compute content hash for accurate change detection
    const contentHash = this.computeFileHash(sessionFile);

    this.index.sessions[sessionId] = {
      session_id: sessionId,
      session_file: sessionFile,
      content_hash: contentHash || undefined,
      last_analyzed_at: new Date().toISOString(),
      last_line_analyzed: lastLine,
      file_size_at_analysis: fileSize,
      patterns_found: patterns.length,
      cached_patterns: patterns,
      pattern_fingerprints: patternFingerprints,
    };

    this.saveIndex();
  }

  /**
   * Merge new patterns with cached patterns
   */
  mergePatterns(sessionId: string, newPatterns: Pattern[]): Pattern[] {
    const cached = this.getCached(sessionId);
    if (!cached || cached.cached_patterns.length === 0) {
      return newPatterns;
    }

    // Group patterns by type
    const patternsByType = new Map<string, Pattern>();

    // Add cached patterns
    for (const pattern of cached.cached_patterns) {
      const key = `${pattern.type}-${pattern.description}`;
      patternsByType.set(key, pattern);
    }

    // Merge or add new patterns
    for (const newPattern of newPatterns) {
      const key = `${newPattern.type}-${newPattern.description}`;
      const existing = patternsByType.get(key);

      if (existing) {
        // Merge occurrences
        existing.occurrences.push(...newPattern.occurrences);
        existing.last_seen = newPattern.last_seen;
        // Recalculate confidence based on merged data
        existing.confidence = Math.max(existing.confidence, newPattern.confidence);
      } else {
        patternsByType.set(key, newPattern);
      }
    }

    return Array.from(patternsByType.values());
  }

  /**
   * Clear cache for a specific session
   */
  clearSession(sessionId: string): void {
    delete this.index.sessions[sessionId];
    this.saveIndex();
  }

  /**
   * Clear all cached analyses
   */
  clearAll(): void {
    this.index.sessions = {};
    this.saveIndex();
  }

  /**
   * Get all cached sessions
   */
  getAllCached(): SessionCacheEntry[] {
    return Object.values(this.index.sessions);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const sessionIds = Object.keys(this.index.sessions);
    const totalPatterns = Object.values(this.index.sessions).reduce(
      (sum, entry) => sum + entry.patterns_found,
      0
    );

    // Count sessions with content hash
    const withHash = Object.values(this.index.sessions).filter(
      entry => !!entry.content_hash
    ).length;

    return {
      total_sessions: sessionIds.length,
      total_patterns_cached: totalPatterns,
      sessions_with_hash: withHash,
      cache_size_kb: this.getCacheSizeKB(),
    };
  }

  /**
   * Prune old cache entries (older than 30 days)
   */
  pruneOld(maxAgeDays: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffISO = cutoffDate.toISOString();

    let pruned = 0;
    for (const [sessionId, entry] of Object.entries(this.index.sessions)) {
      if (entry.last_analyzed_at < cutoffISO) {
        delete this.index.sessions[sessionId];
        pruned++;
      }
    }

    if (pruned > 0) {
      this.saveIndex();
    }

    return pruned;
  }

  private loadIndex(): SessionCacheIndex {
    if (!existsSync(CACHE_INDEX_PATH)) {
      return {
        version: "1.0",
        sessions: {},
      };
    }

    try {
      const data = readFileSync(CACHE_INDEX_PATH, "utf-8");
      return JSON.parse(data) as SessionCacheIndex;
    } catch (error) {
      // console.error("Failed to load session cache index:", error);
      return {
        version: "1.0",
        sessions: {},
      };
    }
  }

  private saveIndex(): void {
    try {
      writeFileSync(CACHE_INDEX_PATH, JSON.stringify(this.index, null, 2));
    } catch (error) {
      // console.error("Failed to save session cache index:", error);
    }
  }

  private getCacheSizeKB(): number {
    if (!existsSync(CACHE_INDEX_PATH)) return 0;
    const stats = statSync(CACHE_INDEX_PATH);
    return Math.round(stats.size / 1024);
  }
}
