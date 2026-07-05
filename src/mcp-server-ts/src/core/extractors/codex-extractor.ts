/**
 * Codex session extractor.
 * Parses Codex JSONL format session files from ~/.codex/sessions/ or archived_sessions/
 */

import { readFileSync } from "fs";
import { SessionExtractor, Message, ToolCall } from "./session-extractor.interface.js";
import { logger } from "../logger.js";

export class CodexSessionExtractor extends SessionExtractor {
  protected readFile(filePath: string): string {
    return readFileSync(filePath, "utf-8");
  }

  protected extractSessionId(filePath: string): string {
    // Codex format: rollout-2026-04-11T23-04-49-019d7d12-fba7-70c1-9942-d5b67682a097.jsonl
    // Extract the UUID at the end
    const fileName = filePath.split("/").pop()?.replace(".jsonl", "") || "unknown";
    const match = fileName.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);
    return match ? match[1] : fileName;
  }

  protected parseLines(content: string): string[] {
    return content.split("\n");
  }

  protected parseLine(line: string): Record<string, any> | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  }

  protected extractProjectPath(data: Record<string, any>): string | undefined {
    // Codex stores cwd in session_meta payload
    if (data.type === "session_meta" && data.payload?.cwd) {
      return data.payload.cwd;
    }
    return undefined;
  }

  protected processLine(
    data: Record<string, any>,
    lineNum: number,
    messages: Message[],
    toolCalls: ToolCall[],
    metadata: Record<string, any>
  ): void {
    // Handle Codex session metadata
    if (data.type === "session_meta" && data.payload) {
      Object.assign(metadata, {
        codex_version: data.payload.cli_version,
        originator: data.payload.originator,
        git: data.payload.git,
        model_provider: data.payload.model_provider,
        source: data.payload.source
      });
      return;
    }

    // Handle Codex response_item format: {type: "response_item", payload: {type: "message", role, content}}
    if (data.type === "response_item" && data.payload) {
      const payload = data.payload;

      // Extract message
      if (payload.type === "message" && (payload.role === "user" || payload.role === "assistant")) {
        const content = this.extractTextContent(payload.content);

        if (content) {
          const message: Message = {
            role: payload.role,
            content: this.sanitizeContent(content),
            timestamp: data.timestamp,
            line_number: lineNum
          };
          messages.push(message);
        }
      }

      // Extract tool calls from content blocks
      if (payload.content && Array.isArray(payload.content)) {
        for (const block of payload.content) {
          if (block.type === "tool_use") {
            const toolCall: ToolCall = {
              tool_name: block.name || "unknown",
              input: block.input || {},
              timestamp: data.timestamp,
              line_number: lineNum
            };
            toolCalls.push(toolCall);
          }
        }
      }

      return;
    }

    // Hand event items (progress, tool results, etc.)
    if (data.type === "event_item" && data.payload) {
      // These are typically tool execution events, we may extract additional context if needed
      return;
    }
  }

  protected handleParseError(error: any, lineNum: number): void {
    logger.warn("codex-extractor", `Skipping malformed JSON at line ${lineNum}`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
