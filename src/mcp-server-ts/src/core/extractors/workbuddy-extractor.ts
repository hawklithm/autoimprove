/**
 * WorkBuddy session extractor.
 *
 * Parses WorkBuddy session transcripts stored under
 *   ~/.workbuddy/projects/<encoded-project-path>/<session-id>.jsonl
 *
 * WorkBuddy emits a Claude Code-compatible JSONL layout, but with two
 * WorkBuddy-specific quirks that this extractor handles:
 *   1. User turns are wrapped in large <system-reminder>/<user_info>/
 *      <identity_context> blocks. We strip that system noise so the
 *      actual user query reaches the analyzer (much cleaner signal than
 *      falling through to the generic Claude Code extractor).
 *   2. The project path is encoded in the parent directory name
 *      (e.g. `d-workspace-autoimprove` -> `D:\\workspace\\autoimprove`),
 *      because the per-line JSON has no `cwd` field.
 */

import { readFileSync } from "fs";
import { basename, dirname } from "path";
import { SessionExtractor, Message, ToolCall, SessionData } from "./session-extractor.interface.js";
import { logger } from "../logger.js";

export class WorkBuddySessionExtractor extends SessionExtractor {
  /**
   * The generic template method calls `extractProjectPath(data)` without the
   * file path, but WorkBuddy encodes the project path in the parent directory
   * name. So we run the base extraction, then backfill project_path from the
   * file path afterwards.
   */
  extract(filePath: string): SessionData {
    const result = super.extract(filePath);
    if (!result.project_path) {
      result.project_path = this.decodeProjectPath(filePath);
    }
    return result;
  }

  /**
   * Satisfies the abstract contract. The real project path is recovered from
   * the file path in `extract()`, since per-line JSON has no `cwd` field.
   */
  protected extractProjectPath(_data: Record<string, any>): string | undefined {
    return undefined;
  }

  protected readFile(filePath: string): string {
    return readFileSync(filePath, "utf-8");
  }

  protected extractSessionId(filePath: string): string {
    return basename(filePath).replace(/\.jsonl$/, "").replace(/\.json$/, "") || "unknown";
  }

  protected parseLines(content: string): string[] {
    return content.split("\n");
  }

  protected parseLine(line: string): Record<string, any> | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  /**
   * Decode the project path from the parent directory name.
   * WorkBuddy encodes `<drive>:/path/to/project` as `<drive>-path-to-project`
   * (path separators become dashes). The drive letter is recovered; the
   * rest is kept verbatim as a stable per-project scope identifier.
   */
  private decodeProjectPath(filePath: string): string | undefined {
    const parent = basename(dirname(filePath));
    const match = parent.match(/^([a-z]):?-(.+)$/i);
    if (match) {
      return `${match[1].toUpperCase()}:/${match[2]}`;
    }
    return parent || undefined;
  }

  protected processLine(
    data: Record<string, any>,
    lineNum: number,
    messages: Message[],
    toolCalls: ToolCall[],
    metadata: Record<string, any>
  ): void {
    // WorkBuddy primary shape: { type: "message", role, content, timestamp }
    if (data.type === "message" && data.role && data.content) {
      const role = data.role === "assistant" || data.role === "user" ? data.role : "assistant";
      const content = this.sanitizeContent(this.extractTextContent(data.content));

      if (content) {
        messages.push({
          role,
          content,
          timestamp: data.timestamp ? String(data.timestamp) : undefined,
          line_number: lineNum
        });
      }

      this.collectToolCalls(data.content, data.timestamp, lineNum, toolCalls);
      if (data.model) metadata.model = data.model;
      return;
    }

    // Claude Code compatible shape: { type: "user"|"assistant", message: {...} }
    if ((data.type === "user" || data.type === "assistant") && data.message) {
      const msgData = data.message;
      const role = msgData.role || data.type;
      const content = this.sanitizeContent(this.extractTextContent(msgData.content || msgData));

      if (content) {
        messages.push({
          role,
          content,
          timestamp: data.timestamp ? String(data.timestamp) : undefined,
          line_number: lineNum
        });
      }

      if (msgData.content && Array.isArray(msgData.content)) {
        this.collectToolCalls(msgData.content, data.timestamp, lineNum, toolCalls);
      }
      return;
    }

    // Fallback: legacy envelope with role + content
    if (data.role && data.content) {
      const role = data.role === "assistant" || data.role === "user" ? data.role : "assistant";
      const content = this.sanitizeContent(this.extractTextContent(data.content));
      if (content) {
        messages.push({ role, content, timestamp: data.timestamp ? String(data.timestamp) : undefined, line_number: lineNum });
      }
      this.collectToolCalls(data.content, data.timestamp, lineNum, toolCalls);
    }
  }

  /**
   * Pull tool_use blocks out of a content array.
   */
  private collectToolCalls(
    content: any,
    timestamp: any,
    lineNum: number,
    toolCalls: ToolCall[]
  ): void {
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block && block.type === "tool_use") {
        toolCalls.push({
          tool_name: block.name || "unknown",
          input: block.input || {},
          timestamp: timestamp ? String(timestamp) : undefined,
          line_number: lineNum
        });
      }
    }
  }

  /**
   * Strip WorkBuddy system-reminder / user_info / identity_context noise so
   * the analyzer sees the real user query, not the injected scaffolding.
   */
  protected sanitizeContent(content: string): string {
    let sanitized = content;

    const systemPatterns = [
      /^<system-reminder[\s\S]*?<\/system-reminder>\s*/i,
      /^<user_info>[\s\S]*?<\/user_info>\s*/i,
      /^<identity_context>[\s\S]*?<\/identity_context>\s*/i,
      /^<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>\s*/i,
      /^<additional_data>[\s\S]*?<\/additional_data>\s*/i,
      /^<command-message>[\s\S]*?<\/command-message>\s*/i,
      /^<environment_context>[\s\S]*?<\/environment_context>/i,
    ];

    for (const pattern of systemPatterns) {
      sanitized = sanitized.replace(pattern, "");
    }

    return super.sanitizeContent(sanitized);
  }

  protected handleParseError(error: any, lineNum: number): void {
    logger.warn("workbuddy-extractor", `Skipping malformed JSON at line ${lineNum}`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
