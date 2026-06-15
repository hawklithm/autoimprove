/**
 * Code Example Extractor - Phase 3
 *
 * Extracts before/after code examples from session tool calls
 */

import { Pattern, PatternOccurrence, CodeExample } from "./models.js";
import * as fs from "fs";
import * as path from "path";

interface SessionMessage {
  role: string;
  content: any;
  tool_calls?: ToolCall[];
}

interface ToolCall {
  type: string;
  function?: {
    name: string;
    arguments: string;
  };
  id?: string;
}

interface ToolResult {
  tool_call_id: string;
  content: string;
}

export class CodeExampleExtractor {
  /**
   * Extract code examples from pattern occurrences
   */
  extractExamples(pattern: Pattern, sessionDir: string): CodeExample[] {
    const examples: CodeExample[] = [];

    for (const occurrence of pattern.occurrences) {
      const sessionFile = path.join(sessionDir, `${occurrence.session_id}.jsonl`);

      if (!fs.existsSync(sessionFile)) {
        continue;
      }

      const sessionExamples = this.extractFromSession(
        sessionFile,
        occurrence.timestamp,
        occurrence.context
      );

      examples.push(...sessionExamples);
    }

    // Deduplicate and limit
    return this.deduplicateExamples(examples).slice(0, 3);
  }

  /**
   * Extract examples from a single session
   */
  private extractFromSession(
    sessionFile: string,
    timestamp: string,
    context: string
  ): CodeExample[] {
    const examples: CodeExample[] = [];

    try {
      const lines = fs.readFileSync(sessionFile, "utf-8").split("\n").filter(Boolean);
      const messages: SessionMessage[] = lines.map(line => JSON.parse(line));

      // Find the relevant message around the timestamp
      const targetIndex = this.findMessageByTimestamp(messages, timestamp);
      if (targetIndex === -1) {
        return [];
      }

      // Look for Edit/Write tool calls before and after
      const beforeCode = this.findCodeBefore(messages, targetIndex, context);
      const afterCode = this.findCodeAfter(messages, targetIndex, context);

      if (afterCode) {
        examples.push({
          bad: beforeCode || undefined,
          good: afterCode,
          explanation: this.generateExplanation(beforeCode, afterCode, context),
          language: this.detectLanguage(context, afterCode)
        });
      }
  } catch (error) {
      console.error(`Failed to extract examples from ${sessionFile}:`, error);
    }

    return examples;
  }

  /**
   * Find message index by timestamp
   */
  private findMessageByTimestamp(messages: SessionMessage[], timestamp: string): number {
    // Try to find by exact timestamp match
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as any;
      if (msg.timestamp === timestamp) {
        return i;
      }
    }

    // Fallback: find user message closest to timestamp
    const targetTime = new Date(timestamp).getTime();
    let closestIndex = -1;
    let closestDiff = Infinity;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as any;
      if (msg.role === "user" && msg.timestamp) {
        const diff = Math.abs(new Date(msg.timestamp).getTime() - targetTime);
        if (diff < closestDiff) {
          closestDiff = diff;
          closestIndex = i;
        }
      }
    }

    return closestIndex;
  }

  /**
   * Find code before correction (from Read tool)
   */
  private findCodeBefore(
    messages: SessionMessage[],
    startIndex: number,
    context: string
  ): string | null {
    const fileName = this.extractFileName(context);
    if (!fileName) {
      return null;
    }

    // Look backward for Read tool calls
    for (let i = startIndex - 1; i >= Math.max(0, startIndex - 10); i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const toolCall of msg.tool_calls) {
          if (toolCall.function?.name === "Read") {
            const args = this.parseToolArgs(toolCall.function.arguments);
            if (args?.file_path?.includes(fileName)) {
              // Find the tool result
              const result = this.findToolResult(messages, i + 1, toolCall.id);
              if (result) {
                return this.extractRelevantCode(result, context);
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Find code after correction (from Edit/Write tool)
   */
  private findCodeAfter(
    messages: SessionMessage[],
    startIndex: number,
    context: string
  ): string | null {
    const fileName = this.extractFileName(context);
    if (!fileName) {
      return null;
    }

    // Look forward for Edit/Write tool calls
    for (let i = startIndex; i < Math.min(messages.length, startIndex + 10); i++) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.tool_calls) {
        for (const toolCall of msg.tool_calls) {
          if (!toolCall.function) continue;

          const toolName = toolCall.function.name;
          if (toolName === "Edit" || toolName === "Write") {
            const args = this.parseToolArgs(toolCall.function.arguments);
            if (args?.file_path?.includes(fileName)) {
              if (toolName === "Edit") {
                return args.new_string || null;
              } else if (toolName === "Write") {
                return this.extractRelevantCode(args.content, context);
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Find tool result message
   */
  private findToolResult(
    messages: SessionMessage[],
    startIndex: number,
    toolCallId?: string
  ): string | null {
    for (let i = startIndex; i < Math.min(messages.length, startIndex + 5); i++) {
      const msg = messages[i] as any;
      if (msg.role === "tool" && msg.tool_call_id === toolCallId) {
        return msg.content || null;
      }
    }
    return null;
  }

  /**
   * Extract file name from context
   */
  private extractFileName(context: string): string | null {
    // Context format: "file_path" or "file_path:line" or "operation on file_path"
    const match = context.match(/([a-zA-Z0-9_-]+\.[a-zA-Z]+)/);
    return match ? match[1] : null;
  }

  /**
   * Parse tool arguments JSON
   */
  private parseToolArgs(argsJson: string): any {
    try {
      return JSON.parse(argsJson);
    } catch {
      return null;
    }
  }

  /**
   * Extract relevant code snippet from full file content
   */
  private extractRelevantCode(fullContent: string, context: string): string {
    // If context includes line number, extract around that line
    const lineMatch = context.match(/:(\d+)/);
    if (lineMatch) {
      const targetLine = parseInt(lineMatch[1], 10);
      const lines = fullContent.split("\n");

      // Extract 10 lines around the target
      const start = Math.max(0, targetLine - 5);
      const end = Math.min(lines.length, targetLine + 5);

      return lines.slice(start, end).join("\n");
    }

    // Otherwise, try to extract relevant function/block
    // For now, just return first 20 lines if content is too long
    const lines = fullContent.split("\n");
    if (lines.length > 20) {
      return lines.slice(0, 20).join("\n") + "\n// ...";
    }

    return fullContent;
  }

  /**
   * Generate explanation for the code change
   */
  private generateExplanation(before: string | null, after: string, context: string): string {
    if (!before) {
      return `New implementation following the pattern.`;
    }

    // Simple heuristic-based explanation
    const explanations: string[] = [];

    if (before.includes("any") && !after.includes("any")) {
      explanations.push("Replaced 'any' with proper types");
    }
    if (before.includes("useReducer") && after.includes("useState")) {
      explanations.push("Simplified to useState for simple state");
    }
    if (before.includes("==") && after.includes("===")) {
      explanations.push("Used strict equality");
    }
    if (before.includes("var ") && after.includes("const ")) {
      explanations.push("Used const instead of var");
    }
    if (!before.includes("try") && after.includes("try")) {
      explanations.push("Added error handling");
    }

    if (explanations.length > 0) {
      return explanations.join("; ");
    }

    return "Improved implementation following the learned pattern.";
  }

  /**
   * Detect programming language from context and code
   */
  private detectLanguage(context: string, code: string): string {
    // From file extension
    const ext = context.match(/\.([a-z]+)$/i);
    if (ext) {
      const extMap: Record<string, string> = {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        py: "python",
        rs: "rust",
        go: "go",
        java: "java",
        kt: "kotlin",
        swift: "swift"
      };
      const lang = extMap[ext[1].toLowerCase()];
      if (lang) return lang;
    }

    // From code patterns
    if (code.includes("interface ") || code.includes(": string")) {
      return "typescript";
    }
    if (code.includes("def ") || code.includes("import ")) {
      return "python";
    }
    if (code.includes("fn ") || code.includes("let mut")) {
      return "rust";
    }

    return "typescript"; // Default
  }

  /**
   * Deduplicate similar examples
   */
  private deduplicateExamples(examples: CodeExample[]): CodeExample[] {
    const unique: CodeExample[] = [];
    const seen = new Set<string>();

    for (const example of examples) {
      // Create a signature for deduplication
      const signature = `${example.bad?.substring(0, 50)}|${example.good.substring(0, 50)}`;

      if (!seen.has(signature)) {
        seen.add(signature);
        unique.push(example);
      }
    }

    return unique;
  }
}
