/**
 * CLI Logger for AutoImprove
 *
 * Provides dual output:
 * 1. Console output for user-friendly CLI experience
 * 2. File logging for debugging and audit trail
 */
export declare enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR"
}
declare class CLILogger {
    private logBuffer;
    private flushInterval;
    private minLevel;
    private consoleEnabled;
    constructor();
    private getStorageRoot;
    private getLogsDir;
    private ensureLogDirectory;
    setConsoleEnabled(enabled: boolean): void;
    setMinLevel(level: LogLevel): void;
    private shouldLog;
    private log;
    /**
     * User-facing output (always to console, logged to file)
     */
    print(message: string, metadata?: Record<string, any>): void;
    /**
     * Error output (always to console, logged to file)
     */
    error(message: string, error?: Error, metadata?: Record<string, any>): void;
    /**
     * Warning output (always to console, logged to file)
     */
    warn(message: string, metadata?: Record<string, any>): void;
    /**
     * Debug info (only to file, not console by default)
     */
    debug(message: string, metadata?: Record<string, any>): void;
    /**
     * Info (to console if enabled, always to file)
     */
    info(message: string, metadata?: Record<string, any>): void;
    /**
     * Progress indicator (console only, not logged)
     */
    progress(message: string): void;
    /**
     * Flush buffered logs to disk
     */
    flush(): void;
    /**
     * Shutdown logger (call before process exit)
     */
    shutdown(): void;
}
export declare const cliLogger: CLILogger;
export {};
//# sourceMappingURL=cli-logger.d.ts.map