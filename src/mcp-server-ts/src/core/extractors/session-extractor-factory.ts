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
import { KiroSessionExtractor } from "./kiro-extractor.js";
import { logger } from "../logger.js";

export enum SessionFormat {
  CLAUDE_CODE = "claude-code",
  CODEX = "codex",
  KIRO = "kiro",
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
      case SessionFormat.KIRO:
        return new KiroSessionExtractor();
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
    const normalizedPath = filePath.replace(/\\/g, "/");
    // Path-based detection (fast)
    if (normalizedPath.includes("/.kiro/sessions/")) {
      return SessionFormat.KIRO;
    }
    if (normalizedPath.includes("/.codex/sessions/") || normalizedPath.includes("/.codex/archived_sessions/")) {
      return SessionFormat.CODEX;
    }

    if (normalizedPath.includes("/.claude/sessions/") || normalizedPath.includes("/.claude/archived_sessions/")) {
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

      // Kiro-specific metadata/events. Parse the envelope so Claude records
      // containing nested tool_result blocks are not misclassified.
      for (const line of firstLines) {
        if (line.includes('"session_metadata"') || line.includes('"agentMode"') || line.includes('"autopilot"')) {
          return SessionFormat.KIRO;
        }
        try {
          const record = JSON.parse(line) as Record<string, any>;
          const type = String(record.type || record.event || record.kind || "").toLowerCase();
          if (["tool_call", "tool_result", "tool-use", "tool-result"].includes(type)) {
            return SessionFormat.KIRO;
          }
        } catch { /* non-JSON content is handled by the extractor */ }
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
    const normalized = dirPath.replace(/\\/g, "/");
    return normalized.includes("/.codex/sessions") || normalized.includes("/.codex/archived_sessions");
  }

  /**
   * Check if a path is a Claude Code session directory
   */
  static isClaudeCodeSessionDir(dirPath: string): boolean {
    const normalized = dirPath.replace(/\\/g, "/");
    return normalized.includes("/.claude/sessions") || normalized.includes("/.claude/archived_sessions");
  }

  static isKiroSessionDir(dirPath: string): boolean {
    return dirPath.replace(/\\/g, "/").includes("/.kiro/sessions");
  }

  /**
   * Get default session directories for both formats
   */
  static getDefaultSessionDirs(): { claudeCode: string[]; codex: string[]; kiro: string[] } {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";

    return {
      claudeCode: [
        `${homeDir}/.claude/sessions`,
        `${homeDir}/.claude/archived_sessions`
      ],
      codex: [
        `${homeDir}/.codex/sessions`,
        `${homeDir}/.codex/archived_sessions`
      ],
      kiro: [`${homeDir}/.kiro/sessions`]
    };
  }
}
