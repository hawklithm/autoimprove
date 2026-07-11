"use strict";
/**
 * CLI Logger for AutoImprove
 *
 * Provides dual output:
 * 1. Console output for user-friendly CLI experience
 * 2. File logging for debugging and audit trail
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cliLogger = exports.LogLevel = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "DEBUG";
    LogLevel["INFO"] = "INFO";
    LogLevel["WARN"] = "WARN";
    LogLevel["ERROR"] = "ERROR";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
class CLILogger {
    constructor() {
        this.logBuffer = [];
        this.flushInterval = null;
        this.minLevel = LogLevel.INFO;
        this.consoleEnabled = true;
        this.ensureLogDirectory();
        // Flush logs every 3 seconds
        this.flushInterval = setInterval(() => this.flush(), 3000);
    }
    getStorageRoot() {
        return process.env.AUTOIMPROVE_STORAGE_ROOT || (0, path_1.join)((0, os_1.homedir)(), '.autoimprove');
    }
    getLogsDir() {
        return (0, path_1.join)(this.getStorageRoot(), 'logs', 'cli');
    }
    ensureLogDirectory() {
        const logsDir = this.getLogsDir();
        if (!(0, fs_1.existsSync)(logsDir)) {
            (0, fs_1.mkdirSync)(logsDir, { recursive: true });
        }
    }
    setConsoleEnabled(enabled) {
        this.consoleEnabled = enabled;
    }
    setMinLevel(level) {
        this.minLevel = level;
    }
    shouldLog(level) {
        const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
        const levelIndex = levels.indexOf(level);
        const minLevelIndex = levels.indexOf(this.minLevel);
        return levelIndex >= minLevelIndex;
    }
    log(level, message, metadata) {
        if (!this.shouldLog(level)) {
            return;
        }
        const entry = {
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
    print(message, metadata) {
        if (this.consoleEnabled) {
            console.log(message);
        }
        this.log(LogLevel.INFO, message, metadata);
    }
    /**
     * Error output (always to console, logged to file)
     */
    error(message, error, metadata) {
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
    warn(message, metadata) {
        if (this.consoleEnabled) {
            console.warn(message);
        }
        this.log(LogLevel.WARN, message, metadata);
    }
    /**
     * Debug info (only to file, not console by default)
     */
    debug(message, metadata) {
        this.log(LogLevel.DEBUG, message, metadata);
    }
    /**
     * Info (to console if enabled, always to file)
     */
    info(message, metadata) {
        if (this.consoleEnabled) {
            console.log(message);
        }
        this.log(LogLevel.INFO, message, metadata);
    }
    /**
     * Progress indicator (console only, not logged)
     */
    progress(message) {
        if (this.consoleEnabled) {
            process.stdout.write(message);
        }
    }
    /**
     * Flush buffered logs to disk
     */
    flush() {
        if (this.logBuffer.length === 0) {
            return;
        }
        const logsDir = this.getLogsDir();
        const today = new Date().toISOString().split('T')[0];
        const logFile = (0, path_1.join)(logsDir, `summarize-${today}.jsonl`);
        try {
            const entries = this.logBuffer.splice(0);
            const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
            (0, fs_1.appendFileSync)(logFile, content);
        }
        catch (error) {
            // Silently fail - don't break CLI if logging fails
        }
    }
    /**
     * Shutdown logger (call before process exit)
     */
    shutdown() {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        this.flush();
    }
}
// Export singleton instance
exports.cliLogger = new CLILogger();
// Ensure logs are flushed on exit
process.on('exit', () => {
    exports.cliLogger.shutdown();
});
process.on('SIGINT', () => {
    exports.cliLogger.shutdown();
    process.exit(130);
});
process.on('SIGTERM', () => {
    exports.cliLogger.shutdown();
    process.exit(143);
});
//# sourceMappingURL=cli-logger.js.map