/**
 * JSONL parser for Claude Code session files.
 *
 * Parses session files in JSONL format and extracts messages and tool calls.
 */

import { readFileSync } from "fs";
import { logger } from "./logger.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
  line_number: number;
}

export interface ToolCall {
  tool_name: string;
  input: Record<string, any>;
  timestamp?: string;
  line_number: number;
}

export interface SessionData {
  session_id: string;
  messages: Message[];
  tool_calls: ToolCall[];
  metadata: Record<string, any>;
}

export class JSONLParser {
  parseFile(filePath: string): SessionData {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    const messages: Message[] = [];
    const toolCalls: ToolCall[] = [];
    const metadata: Record<string, any> = {};

    // Extract session ID from filename
    const sessionId = filePath.split("/").pop()?.replace(".jsonl", "") || "unknown";

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum].trim();
      if (!line) continue;

      try {
        const data = JSON.parse(line);
        this.processLine(data, lineNum + 1, messages, toolCalls, metadata);
      } catch (error) {
        logger.warn("jsonl-parser", `Warning: Skipping malformed JSON at line ${lineNum + 1}`, { error: error instanceof Error ? error.message : String(error) });
        continue;
      }
    }

    // Return empty session data for files with only metadata (empty sessions)
    // This is not an error - it's a valid case for newly created or unused sessions
    return {
      session_id: sessionId,
      messages,
      tool_calls: toolCalls,
      metadata
    };
  }

  private processLine(
    data: Record<string, any>,
    lineNum: number,
    messages: Message[],
    toolCalls: ToolCall[],
    metadata: Record<string, any>
  ): void {
    // Handle Claude Code format: {type: "user"|"assistant", message: {role, content}}
    if ((data.type === "user" || data.type === "assistant") && data.message) {
      const msgData = data.message;
      const message: Message = {
        role: msgData.role || data.type,
        content: this.extractContent(msgData),
        timestamp: data.timestamp,
        line_number: lineNum
      };
      messages.push(message);
      return;
    }

    // Extract message (legacy format)
    if (data.type === "message" || data.role) {
      const message: Message = {
        role: data.role || "assistant",
        content: this.extractContent(data),
        timestamp: data.timestamp,
        line_number: lineNum
      };
      messages.push(message);
    }

    // Extract tool calls from tool_use content blocks in assistant messages
    if (data.message && data.message.content && Array.isArray(data.message.content)) {
      for (const block of data.message.content) {
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

  private extractContent(data: Record<string, any>): string {
    if (typeof data.content === "string") {
      return data.content;
    }

    if (Array.isArray(data.content)) {
      return data.content
        .map((block: any) => {
          if (typeof block === "string") return block;
          if (block.type === "text") return block.text;
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }

    if (data.text) {
      return data.text;
    }

    return "";
  }
}
