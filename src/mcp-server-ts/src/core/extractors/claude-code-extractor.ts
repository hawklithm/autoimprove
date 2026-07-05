/**
 * Claude Code session extractor.
 * Parses Claude Code JSONL format session files.
 */

import { readFileSync } from "fs";
import { SessionExtractor, Message, ToolCall } from "./session-extractor.interface.js";
import { logger } from "../logger.js";

export class ClaudeCodeSessionExtractor extends SessionExtractor {
  protected readFile(filePath: string): string {
    return readFileSync(filePath, "utf-8");
  }

  protected extractSessionId(filePath: string): string {
    return filePath.split("/").pop()?.replace(".jsonl", "") || "unknown";
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
    return data.cwd;
  }

  protected processLine(
    data: Record<string, any>,
    lineNum: number,
    messages: Message[],
    toolCalls: ToolCall[],
    metadata: Record<string, any>
  ): void {
    // Handle Claude Code format: {type: "user"|"assistant", message: {role, content}}
    if ((data.type === "user" || data.type === "assistant") && data.message) {
      const msgData = data.message;
      const content = this.extractTextContent(msgData.content || msgData);

      if (content) {
        const message: Message = {
          role: msgData.role || data.type,
          content: this.sanitizeContent(content),
          timestamp: data.timestamp,
          line_number: lineNum
        };
        messages.push(message);
      }

      // Extract tool calls from tool_use content blocks in assistant messages
      if (msgData.content && Array.isArray(msgData.content)) {
        for (const block of msgData.content) {
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

    // Extract message (legacy format)
    if (data.type === "message" || (data.role && data.content)) {
      const content = this.extractTextContent(data.content || data);

      if (content) {
        const message: Message = {
          role: data.role || "assistant",
          content: this.sanitizeContent(content),
          timestamp: data.timestamp,
          line_number: lineNum
        };
        messages.push(message);
      }
    }

    // Extract tool calls (legacy format)
    if (data.type === "tool_use" || data.tool_name) {
      const toolCall: ToolCall = {
        tool_name: data.tool_name || data.name || "unknown",
        input: data.input || data.parameters || {},
        timestamp: data.timestamp,
        line_number: lineNum
      };
      toolCalls.push(toolCall);
    }

    // Extract metadata
    if (data.metadata) {
      Object.assign(metadata, data.metadata);
    }
  }

  protected handleParseError(error: any, lineNum: number): void {
    logger.warn("claude-code-extractor", `Skipping malformed JSON at line ${lineNum}`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
