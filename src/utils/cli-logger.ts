/**
 * CLI Logger for AutoImprove
 *
 * Provides dual output:
 * 1. Console output for user-friendly CLI experience
 * 2. File logging for debugging and audit trail
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, any>;
}

class CLILogger {
  private logBuffer: LogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private minLevel: LogLevel = LogLevel.INFO;
  private consoleEnabled: boolean = true;

  constructor() {
    this.ensureLogDirectory();
    // Flush logs every 3 seconds
    this.flushInterval = setInterval(() => this.flush(), 3000);
  }

  private getStorageRoot(): string {
    return process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), '.autoimprove');
  }

  private getLogsDir(): string {
    return join(this.getStorageRoot(), 'logs', 'cli');
  }

  private ensureLogDirectory(): void {
    const logsDir = this.getLogsDir();
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
  }

  setConsoleEnabled(enabled: boolean): void {
    this.consoleEnabled = enabled;
  }

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const levelIndex = levels.indexOf(level);
    const minLevelIndex = levels.indexOf(this.minLevel);
    return levelIndex >= minLevelIndex;
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, any>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
    };

    this.logBuffer.push(entry);

    // Flush immediately for errors
    if (level === LogLevel.ERROR) {
      this.flush();
    }
  }

  /**
   * User-facing output (always to console, logged to file)
   */
  print(message: string, metadata?: Record<string, any>): void {
    if (this.consoleEnabled) {
      console.log(message);
    }
    this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Error output (always to console, logged to file)
   */
  error(message: string, error?: Error, metadata?: Record<string, any>): void {
    if (this.consoleEnabled) {
      console.error(message);
    }
    this.log(LogLevel.ERROR, message, {
      ...metadata,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : undefined,
    });
  }

  /**
   * Warning output (always to console, logged to file)
   */
  warn(message: string, metadata?: Record<string, any>): void {
    if (this.consoleEnabled) {
      console.warn(message);
    }
    this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * Debug info (only to file, not console by default)
   */
  debug(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  /**
   * Info (to console if enabled, always to file)
   */
  info(message: string, metadata?: Record<string, any>): void {
    if (this.consoleEnabled) {
      console.log(message);
    }
    this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Progress indicator (console only, not logged)
   */
  progress(message: string): void {
    if (this.consoleEnabled) {
      process.stdout.write(message);
    }
  }

  /**
   * Flush buffered logs to disk
   */
  flush(): void {
    if (this.logBuffer.length === 0) {
      return;
    }

    const logsDir = this.getLogsDir();
    const today = new Date().toISOString().split('T')[0];
    const logFile = join(logsDir, `summarize-${today}.jsonl`);

    try {
      const entries = this.logBuffer.splice(0);
      const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
      appendFileSync(logFile, content);
    } catch (error) {
      // Silently fail - don't break CLI if logging fails
    }
  }

  /**
   * Shutdown logger (call before process exit)
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
export const cliLogger = new CLILogger();

// Ensure logs are flushed on exit
process.on('exit', () => {
  cliLogger.shutdown();
});

process.on('SIGINT', () => {
  cliLogger.shutdown();
  process.exit(130);
});

process.on('SIGTERM', () => {
  cliLogger.shutdown();
  process.exit(143);
});
