/**
 * Pattern Evolution Tracker
 *
 * Tracks patterns across multiple sessions and rebuild cycles to:
 * 1. Calculate enhanced confidence scores based on history
 * 2. Identify high-value patterns (frequent + validated)
 * 3. Support incremental confidence improvement
 */

import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { CACHE_DIR } from "./init.js";
import { Pattern, PatternType } from "../core/models.js";
import { createHash } from "crypto";
import { logger } from "./../core/logger.js";

export interface PatternEvolutionEntry {
  fingerprint: string;
  type: PatternType;
  description: string;
  first_seen: string;
  last_seen: string;
  sessions: string[];
  occurrences: number;
  confidence_history: Array<{
    date: string;
    confidence: number;
    sessions: number;
  }>;
  feedback_count: {
    used: number;
    validated: number;
    ignored: number;
    corrected: number;
  };
  current_rule_id?: string;
}

export interface PatternEvolutionIndex {
  version: string;
  patterns: Record<string, PatternEvolutionEntry>;
}

const EVOLUTION_INDEX_PATH = join(CACHE_DIR, "pattern-evolution.json");

export class PatternEvolutionManager {
  private index: PatternEvolutionIndex;

  constructor() {
    this.index = this.loadIndex();
  }

  /**
   * Generate unique fingerprint for a pattern
   * Same pattern across sessions → same fingerprint
   */
  generateFingerprint(pattern: Pattern): string {
    // Normalize description (case-insensitive, trim)
    const normalized = pattern.description.toLowerCase().trim();

    // Create unique key: type + normalized description
    const key = `${pattern.type}:${normalized}`;

    // Hash for shorter storage (8 chars)
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 8);

    return `pattern-fp-${hash}`;
  }

  /**
   * Record a pattern occurrence
   */
  recordOccurrence(
    pattern: Pattern,
    sessionId: string,
    ruleId?: string
  ): string {
    const fingerprint = this.generateFingerprint(pattern);
    const now = new Date().toISOString();
    const today = now.split('T')[0];

    let entry = this.index.patterns[fingerprint];

    if (!entry) {
      // New pattern
      entry = {
        fingerprint,
        type: pattern.type,
        description: pattern.description,
        first_seen: now,
        last_seen: now,
        sessions: [sessionId],
        occurrences: 1,
        confidence_history: [
          {
            date: today,
            confidence: pattern.confidence,
            sessions: 1,
          },
        ],
        feedback_count: {
          used: 0,
          validated: 0,
          ignored: 0,
          corrected: 0,
        },
      };
    } else {
      // Update existing pattern
      entry.last_seen = now;

      // Add session if not already tracked
      if (!entry.sessions.includes(sessionId)) {
        entry.sessions.push(sessionId);
      }

      entry.occurrences += 1;

      // Update confidence history
      const lastHistory = entry.confidence_history[entry.confidence_history.length - 1];
      if (lastHistory && lastHistory.date === today) {
        // Update today's entry
        lastHistory.confidence = Math.max(lastHistory.confidence, pattern.confidence);
        lastHistory.sessions = entry.sessions.length;
      } else {
        // Add new history entry
        entry.confidence_history.push({
          date: today,
          confidence: pattern.confidence,
          sessions: entry.sessions.length,
        });
      }
    }

    // Update rule association
    if (ruleId) {
      entry.current_rule_id = ruleId;
    }

    this.index.patterns[fingerprint] = entry;
    this.saveIndex();

    return fingerprint;
  }

  /**
   * Record feedback for a pattern
   */
  recordFeedback(
    fingerprint: string,
    feedbackType: 'used' | 'validated' | 'ignored' | 'corrected'
  ): void {
    const entry = this.index.patterns[fingerprint];
    if (!entry) return;

    entry.feedback_count[feedbackType] += 1;
    this.saveIndex();
  }

  /**
   * Get evolution data for a pattern
   */
  getEvolution(fingerprint: string): PatternEvolutionEntry | null {
    return this.index.patterns[fingerprint] || null;
  }

  /**
   * Get evolution by rule ID
   */
  getEvolutionByRuleId(ruleId: string): PatternEvolutionEntry | null {
    for (const entry of Object.values(this.index.patterns)) {
      if (entry.current_rule_id === ruleId) {
        return entry;
      }
    }
    return null;
  }

  /**
   * Get all patterns matching criteria
   */
  getPatterns(filters: {
    minOccurrences?: number;
    minSessions?: number;
    type?: PatternType;
    hasRuleId?: boolean;
  } = {}): PatternEvolutionEntry[] {
    let patterns = Object.values(this.index.patterns);

    if (filters.minOccurrences !== undefined) {
      patterns = patterns.filter(p => p.occurrences >= filters.minOccurrences!);
    }

    if (filters.minSessions !== undefined) {
      patterns = patterns.filter(p => p.sessions.length >= filters.minSessions!);
    }

    if (filters.type) {
      patterns = patterns.filter(p => p.type === filters.type);
    }

    if (filters.hasRuleId !== undefined) {
      patterns = patterns.filter(p =>
        filters.hasRuleId ? !!p.current_rule_id : !p.current_rule_id
      );
    }

    return patterns;
  }

  /**
   * Calculate enhanced confidence score using evolution data
   */
  calculateEnhancedConfidence(
    baseConfidence: number,
    fingerprint: string
  ): number {
    const evolution = this.getEvolution(fingerprint);
    if (!evolution) return baseConfidence;

    // Bonus for multi-session appearance (up to +0.20)
    const sessionBonus = Math.min(evolution.sessions.length * 0.05, 0.20);

    // Bonus for time span (up to +0.10)
    const firstDate = new Date(evolution.first_seen);
    const lastDate = new Date(evolution.last_seen);
    const daySpan = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24);
    const timeBonus = Math.min(daySpan / 30 * 0.10, 0.10);

    // Bonus for positive feedback (up to +0.15)
    const totalFeedback =
      evolution.feedback_count.used +
      evolution.feedback_count.validated +
      evolution.feedback_count.ignored +
      evolution.feedback_count.corrected;

    const positiveFeedback =
      evolution.feedback_count.used + evolution.feedback_count.validated;

    const feedbackRatio = totalFeedback > 0 ? positiveFeedback / totalFeedback : 0;
    const feedbackBonus = feedbackRatio * 0.15;

    // Penalty for negative feedback (up to -0.20)
    const negativeFeedback =
      evolution.feedback_count.ignored + evolution.feedback_count.corrected;
    const negativeRatio = totalFeedback > 0 ? negativeFeedback / totalFeedback : 0;
    const feedbackPenalty = negativeRatio * 0.20;

    const enhancedScore = Math.min(
      baseConfidence + sessionBonus + timeBonus + feedbackBonus - feedbackPenalty,
      1.0
    );

    return Math.max(enhancedScore, 0.0);
  }

  /**
   * Get statistics about pattern evolution
   */
  getStats() {
    const patterns = Object.values(this.index.patterns);

    const totalPatterns = patterns.length;
    const totalOccurrences = patterns.reduce((sum, p) => sum + p.occurrences, 0);
    const totalSessions = new Set(patterns.flatMap(p => p.sessions)).size;

    const withRules = patterns.filter(p => p.current_rule_id).length;
    const withFeedback = patterns.filter(p =>
      p.feedback_count.used > 0 ||
      p.feedback_count.validated > 0 ||
      p.feedback_count.ignored > 0 ||
      p.feedback_count.corrected > 0
    ).length;

    const avgOccurrences = totalPatterns > 0 ? totalOccurrences / totalPatterns : 0;
    const avgSessions = totalPatterns > 0
      ? patterns.reduce((sum, p) => sum + p.sessions.length, 0) / totalPatterns
      : 0;

    return {
      total_patterns: totalPatterns,
      total_occurrences: totalOccurrences,
      total_sessions: totalSessions,
      patterns_with_rules: withRules,
      patterns_with_feedback: withFeedback,
      avg_occurrences_per_pattern: Math.round(avgOccurrences * 10) / 10,
      avg_sessions_per_pattern: Math.round(avgSessions * 10) / 10,
    };
  }

  /**
   * Prune patterns not seen in X days
   */
  pruneStalePatterns(maxAgeDays: number = 180): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffISO = cutoffDate.toISOString();

    let pruned = 0;
    for (const [fingerprint, entry] of Object.entries(this.index.patterns)) {
      if (entry.last_seen < cutoffISO) {
        delete this.index.patterns[fingerprint];
        pruned++;
      }
    }

    if (pruned > 0) {
      this.saveIndex();
    }

    return pruned;
  }

  /**
   * Clear all evolution data
   */
  clearAll(): void {
    this.index.patterns = {};
    this.saveIndex();
  }

  /**
   * Export evolution data for a specific pattern (for debugging)
   */
  exportPatternHistory(fingerprint: string): string {
    const entry = this.getEvolution(fingerprint);
    if (!entry) return "Pattern not found";

    let output = `Pattern: ${entry.description}\n`;
    output += `Type: ${entry.type}\n`;
    output += `Fingerprint: ${entry.fingerprint}\n`;
    output += `First seen: ${entry.first_seen}\n`;
    output += `Last seen: ${entry.last_seen}\n`;
    output += `Sessions: ${entry.sessions.length} (${entry.sessions.join(', ')})\n`;
    output += `Occurrences: ${entry.occurrences}\n`;
    output += `Current rule: ${entry.current_rule_id || 'None'}\n\n`;

    output += `Confidence History:\n`;
    for (const h of entry.confidence_history) {
      output += `  ${h.date}: ${h.confidence.toFixed(2)} (${h.sessions} sessions)\n`;
    }

    output += `\nFeedback:\n`;
    output += `  Used: ${entry.feedback_count.used}\n`;
    output += `  Validated: ${entry.feedback_count.validated}\n`;
    output += `  Ignored: ${entry.feedback_count.ignored}\n`;
    output += `  Corrected: ${entry.feedback_count.corrected}\n`;

    return output;
  }

  private loadIndex(): PatternEvolutionIndex {
    if (!existsSync(EVOLUTION_INDEX_PATH)) {
      return {
        version: "1.0",
        patterns: {},
      };
    }

    try {
      const data = readFileSync(EVOLUTION_INDEX_PATH, "utf-8");
      return JSON.parse(data) as PatternEvolutionIndex;
    } catch (error) {
      logger.consoleError("Failed to load pattern evolution index:", error);
      return {
        version: "1.0",
        patterns: {},
      };
    }
  }

  private saveIndex(): void {
    try {
      writeFileSync(EVOLUTION_INDEX_PATH, JSON.stringify(this.index, null, 2));
    } catch (error) {
      logger.consoleError("Failed to save pattern evolution index:", error);
    }
  }
}
