/**
 * Unified session parser that auto-detects format and extracts session data.
 *
 * This replaces JSONLParser with a format-agnostic approach that supports
 * both Claude Code and Codex dialog formats.
 */

import { SessionExtractorFactory, SessionData } from "./extractors/index.js";

export class UnifiedSessionParser {
  /**
   * Parse a session file (auto-detects format)
   */
  parseFile(filePath: string): SessionData {
    const extractor = SessionExtractorFactory.create(filePath);
    return extractor.extract(filePath);
  }

  /**
   * Get supported formats
   */
  getSupportedFormats(): string[] {
    return ["claude-code", "codex"];
  }
}

// Export legacy interface for backward compatibility
export { SessionData, Message, ToolCall } from "./extractors/index.js";
