/**
 * Factory for creating session extractors.
 * Auto-detects format and returns appropriate extractor.
 *
 * Factory Method pattern: creates extractors based on file format detection
 */

import { readFileSync } from "fs";
import { SessionExtractor } from "./session-extractor.interface.js";
import { ClaudeCodeSessionExtractor } from "./claude-code-extractor.js";
import { CodexSessionExtractor } from "./codex-extractor.js";
import { logger } from "../logger.js";

export enum SessionFormat {
  CLAUDE_CODE = "claude-code",
  CODEX = "codex",
  UNKNOWN = "unknown"
}

export class SessionExtractorFactory {
  /**
   * Create appropriate extractor based on file path and content
   */
  static create(filePath: string): SessionExtractor {
    const format = this.detectFormat(filePath);

    logger.debug("session-extractor-factory", `Detected format: ${format} for ${filePath}`);

    switch (format) {
      case SessionFormat.CLAUDE_CODE:
        return new ClaudeCodeSessionExtractor();
      case SessionFormat.CODEX:
        return new CodexSessionExtractor();
      default:
        // Default to Claude Code for backward compatibility
        logger.warn("session-extractor-factory", `Unknown format for ${filePath}, defaulting to Claude Code`);
        return new ClaudeCodeSessionExtractor();
    }
  }

  /**
   * Detect session format from file path and content
   */
  private static detectFormat(filePath: string): SessionFormat {
    // Path-based detection (fast)
    if (filePath.includes("/.codex/sessions/") || filePath.includes("/.codex/archived_sessions/")) {
      return SessionFormat.CODEX;
    }

    if (filePath.includes("/.claude/sessions/") || filePath.includes("/.claude/archived_sessions/")) {
      return SessionFormat.CLAUDE_CODE;
    }

    // Content-based detection (fallback)
    try {
      const firstLines = this.readFirstLines(filePath, 5);

      // Check for Codex-specific patterns
      for (const line of firstLines) {
        if (line.includes('"type":"session_meta"') && line.includes('"originator":"codex_cli_rs"')) {
          return SessionFormat.CODEX;
        }
        if (line.includes('"type":"response_item"')) {
          return SessionFormat.CODEX;
        }
      }

      // Check for Claude Code patterns
      for (const line of firstLines) {
        if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) {
          return SessionFormat.CLAUDE_CODE;
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("session-extractor-factory", `Failed to detect format from content: ${errorMsg}`);
    }

    return SessionFormat.UNKNOWN;
  }

  /**
   * Read first N lines from file for format detection
   */
  private static readFirstLines(filePath: string, count: number): string[] {
    try {
      const content = readFileSync(filePath, "utf-8");
      return content.split("\n").slice(0, count).filter(line => line.trim());
    } catch (error) {
      return [];
    }
  }

  /**
   * Check if a path is a Codex session directory
   */
  static isCodexSessionDir(dirPath: string): boolean {
    return dirPath.includes("/.codex/sessions") || dirPath.includes("/.codex/archived_sessions");
  }

  /**
   * Check if a path is a Claude Code session directory
   */
  static isClaudeCodeSessionDir(dirPath: string): boolean {
    return dirPath.includes("/.claude/sessions") || dirPath.includes("/.claude/archived_sessions");
  }

  /**
   * Get default session directories for both formats
   */
  static getDefaultSessionDirs(): { claudeCode: string[]; codex: string[] } {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";

    return {
      claudeCode: [
        `${homeDir}/.claude/sessions`,
        `${homeDir}/.claude/archived_sessions`
      ],
      codex: [
        `${homeDir}/.codex/sessions`,
        `${homeDir}/.codex/archived_sessions`
      ]
    };
  }
}
