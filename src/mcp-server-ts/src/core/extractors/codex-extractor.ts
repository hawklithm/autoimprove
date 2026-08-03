/**
 * Codex session extractor.
 * Parses Codex JSONL format session files from ~/.codex/sessions/ or archived_sessions/
 */

import { readFileSync } from "fs";
import { basename } from "path";
import { SessionExtractor, Message, ToolCall } from "./session-extractor.interface.js";
import { logger } from "../logger.js";

export class CodexSessionExtractor extends SessionExtractor {
  protected readFile(filePath: string): string {
    return readFileSync(filePath, "utf-8");
  }

  protected extractSessionId(filePath: string): string {
    // Codex format: rollout-2026-04-11T23-04-49-019d7d12-fba7-70c1-9942-d5b67682a097.jsonl
    // Extract the UUID at the end
    const fileName = basename(filePath).replace(/\.jsonl$/, "") || "unknown";
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

      // FIX 1: Extract messages from all roles (user, assistant, developer)
      if (payload.type === "message" && payload.role) {
        // Support user, assistant, and developer roles
        const allowedRoles = ["user", "assistant", "developer"];
        if (allowedRoles.includes(payload.role)) {
          const content = this.extractTextContent(payload.content);

          if (content) {
            // Map 'developer' to 'system' for compatibility with Message interface
            const role = payload.role === "developer" ? "system" : payload.role;
            
            const message: Message = {
              role: role as "user" | "assistant" | "system",
              content: this.sanitizeContent(content),
              timestamp: data.timestamp,
              line_number: lineNum
            };
            messages.push(message);
          }
        }

        if (Array.isArray(payload.content)) {
          for (const block of payload.content) {
            if (!block || !["tool_use", "tool_call"].includes(block.type)) continue;
            toolCalls.push({
              tool_name: block.name || block.tool_name || "unknown",
              input: block.input || block.arguments || {},
              timestamp: data.timestamp,
              line_number: lineNum
            });
          }
        }
      }

      // FIX 3: Handle independent function_call type (NOT in message.content)
      if (payload.type === "function_call") {
        // Parse arguments (it's a JSON string in Codex format)
        let parsedInput: Record<string, any> = {};
        try {
          if (typeof payload.arguments === "string") {
            parsedInput = JSON.parse(payload.arguments);
          } else if (typeof payload.arguments === "object") {
            parsedInput = payload.arguments;
          }
        } catch (e) {
          logger.warn("codex-extractor", `Failed to parse function arguments at line ${lineNum}`, {
            error: e instanceof Error ? e.message : String(e),
            arguments: payload.arguments
          });
          // Store raw arguments if parsing fails
          parsedInput = { raw: payload.arguments };
        }

        const toolCall: ToolCall = {
          tool_name: payload.name || "unknown",
          input: parsedInput,
          timestamp: data.timestamp,
          line_number: lineNum
        };
        toolCalls.push(toolCall);
      }

      // FIX 4: Handle function_call_output
      if (payload.type === "function_call_output") {
        // Store tool outputs in metadata for later analysis
        if (!metadata.tool_outputs) {
          metadata.tool_outputs = {};
        }
        
        const callId = payload.call_id || `line_${lineNum}`;
        metadata.tool_outputs[callId] = {
          content: payload.content,
          timestamp: data.timestamp,
          line_number: lineNum
        };
      }

      return;
    }

    // Handle event items (progress, tool results, etc.)
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
