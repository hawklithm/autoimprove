/**
 * Structured logging for AutoImprove.
 *
 * Provides structured, contextual logging with levels and metadata.
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { Pattern } from "./models.js";

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  metadata?: Record<string, any>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export class StructuredLogger {
  private static instance: StructuredLogger;
  private logBuffer: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private minLevel: LogLevel = LogLevel.INFO;

  private constructor() {
    this.ensureLogDirectory();
    // Flush logs every 5 seconds
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  static getInstance(): StructuredLogger {
    if (!StructuredLogger.instance) {
      StructuredLogger.instance = new StructuredLogger();
    }
    return StructuredLogger.instance;
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private getStorageRoot(): string {
    return process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
  }

  private getLogsDir(): string {
    return join(this.getStorageRoot(), "logs");
  }

  private ensureLogDirectory(): void {
    const logsDir = this.getLogsDir();
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const levelIndex = levels.indexOf(level);
    const minLevelIndex = levels.indexOf(this.minLevel);
    return levelIndex >= minLevelIndex;
  }

  private log(level: LogLevel, category: string, message: string, metadata?: Record<string, any>, error?: Error): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      metadata,
    };

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    this.logBuffer.push(entry);

    // Also log to console for immediate feedback
    const consoleMessage = `[${entry.timestamp}] [${level}] [${category}] ${message}`;
    if (level === LogLevel.ERROR) {
      console.error(consoleMessage, metadata || "", error || "");
    } else if (level === LogLevel.WARN) {
      console.warn(consoleMessage, metadata || "");
    } else {
      console.error(consoleMessage); // Use stderr for structured logs
    }

    // Flush immediately for errors
    if (level === LogLevel.ERROR) {
      this.flush();
    }
  }

  debug(category: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, category, message, metadata);
  }

  info(category: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, category, message, metadata);
  }

  warn(category: string, message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, category, message, metadata);
  }

  error(category: string, message: string, error?: Error, metadata?: Record<string, any>): void {
    this.log(LogLevel.ERROR, category, message, metadata, error);
  }

  /**
   * Log pattern detection activity
   */
  logPatternDetection(sessionId: string, patterns: Pattern[], analysisMode: string): void {
    this.info("pattern-detection", `Detected ${patterns.length} patterns`, {
      session_id: sessionId,
      analysis_mode: analysisMode,
      pattern_types: patterns.reduce((acc, p) => {
        acc[p.type] = (acc[p.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      high_confidence_count: patterns.filter((p) => p.confidence > 0.7).length,
    });
  }

  /**
   * Log rule generation activity
   */
  logRuleGeneration(patterns: Pattern[], generatedCount: number, skippedCount: number): void {
    this.info("rule-generation", `Generated ${generatedCount} rules from ${patterns.length} patterns`, {
      generated: generatedCount,
      skipped: skippedCount,
      avg_confidence:
        patterns.length > 0
          ? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
          : 0 });
  }

  /**
   * Log rule matching activity
   */
  logRuleMatching(sceneDesc: string, matchCount: number, totalRules: number): void {
    this.debug("rule-matching", `Found ${matchCount}/${totalRules} matching rules`, {
      scene: sceneDesc,
      match_rate: totalRules > 0 ? matchCount / totalRules : 0,
    });
  }

  /**
   * Log performance metrics
   */
  logPerformance(operation: string, durationMs: number, metadata?: Record<string, any>): void {
    const level = durationMs > 1000 ? LogLevel.WARN : LogLevel.DEBUG;
    this.log(level, "performance", `${operation} took ${durationMs}ms`, {
      operation,
      duration_ms: durationMs,
      ...metadata,
    });
  }

  /**
   * Log cache hit/miss
   */
  logCacheActivity(operation: "hit" | "miss" | "invalidate", sessionId: string, metadata?: Record<string, any>): void {
    this.debug("cache", `Cache ${operation} for session ${sessionId}`, {
      operation,
      session_id: sessionId,
      ...metadata,
    });
  }

  /**
   * Log rule quality assessment
   */
  logQualityAssessment(ruleId: string, score: number, issues: string[]): void {
    const level = score < 0.5 ? LogLevel.WARN : LogLevel.INFO;
    this.log(level, "rule-quality", `Rule ${ruleId} quality: ${score.toFixed(2)}`, {
      rule_id: ruleId,
      quality_score: score,
      issue_count: issues.length,
      issues: issues,
    });
  }

  /**
   * Log conflict detection
   */
  logConflictDetection(ruleId: string, conflictCount: number, severity: string): void {
    const level = conflictCount > 0 ? LogLevel.WARN : LogLevel.DEBUG;
    this.log(level, "conflict-detection", `Rule ${ruleId} has ${conflictCount} conflicts`, {
      rule_id: ruleId,
      conflict_count: conflictCount,
      max_severity: severity,
    });
  }

  /**
   * Flush buffered logs to disk
   */
  flush(): void {
    if (this.logBuffer.length === 0) {
      return;
    }

    const logsDir = this.getLogsDir();
    const today = new Date().toISOString().split("T")[0];
    const logFile = join(logsDir, `autoimprove-${today}.jsonl`);

    try {
      const entries = this.logBuffer.splice(0);
      const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
      appendFileSync(logFile, content);
    } catch (error) {
      console.error("Failed to flush logs:", error);
    }
  }

  /**
   * Shutdown logger
   */
  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }
}

// Export singleton instance
export const logger = StructuredLogger.getInstance();
