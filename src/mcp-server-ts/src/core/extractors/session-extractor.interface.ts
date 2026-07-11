/**
 * Session extractor interface for different dialog formats.
 *
 * Strategy pattern: Each extractor implements this interface
 * to support different dialog systems (Claude Code, Codex, etc.)
 */

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
  project_path?: string;
}

/**
 * Abstract base class for session extractors.
 * Implements Template Method pattern for common extraction logic.
 */
export abstract class SessionExtractor {
  /**
   * Extract session data from a file.
   * Template method that orchestrates the extraction process.
   */
  extract(filePath: string): SessionData {
    const rawContent = this.readFile(filePath);
    const sessionId = this.extractSessionId(filePath);
    const lines = this.parseLines(rawContent);

    const messages: Message[] = [];
    const toolCalls: ToolCall[] = [];
    const metadata: Record<string, any> = {};
    let projectPath: string | undefined;

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];
      if (!line) continue;

      try {
        const data = this.parseLine(line);
        if (!data) continue;

        // Extract project path (first occurrence)
        if (!projectPath) {
          projectPath = this.extractProjectPath(data);
        }

        this.processLine(data, lineNum + 1, messages, toolCalls, metadata);
      } catch (error) {
        this.handleParseError(error, lineNum + 1);
      }
    }

    return {
      session_id: sessionId,
      messages,
      tool_calls: toolCalls,
      metadata,
      project_path: projectPath
    };
  }

  /**
   * Read file content (can be overridden for custom reading logic)
   */
  protected abstract readFile(filePath: string): string;

  /**
   * Extract session ID from file path
   */
  protected abstract extractSessionId(filePath: string): string;

  /**
   * Parse raw content into lines
   */
  protected abstract parseLines(content: string): string[];

  /**
   * Parse a single line into data object
   */
  protected abstract parseLine(line: string): Record<string, any> | null;

  /**
   * Extract project path from data
   */
  protected abstract extractProjectPath(data: Record<string, any>): string | undefined;

  /**
   * Process a parsed line and populate messages/toolCalls/metadata
   */
  protected abstract processLine(
    data: Record<string, any>,
    lineNum: number,
    messages: Message[],
    toolCalls: ToolCall[],
    metadata: Record<string, any>
  ): void;

  /**
   * Handle parse errors
   */
  protected abstract handleParseError(error: any, lineNum: number): void;

  /**
   * Sanitize content by removing system noise
   */
  protected sanitizeContent(content: string): string {
    let sanitized = content;

    // Remove common system metadata patterns
    const systemPatterns = [
      /^Base directory for this skill:.*?\n\n/s,
      /^<command-message>[\s\S]*?<\/command-message>\s*/,
      /^<command-name>[\s\S]*?<\/command-name>\s*/,
      /^<command-args>[\s\S]*?<\/command-args>\s*/,
      /^# AGENTS\.md instructions for.*?\n<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/,
      /^<environment_context>[\s\S]*?<\/environment_context>/,
    ];

    for (const pattern of systemPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }

    return sanitized.trim();
  }

  /**
   * Extract text content from various content formats
   * FIX 2: Added support for output_text type
   */
  protected extractTextContent(content: any): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((block: any) => {
          if (typeof block === "string") return block;
          if (block.type === "text") return block.text;
          if (block.type === "input_text") return block.text;
          if (block.type === "output_text") return block.text;  // FIX 2: Added this line
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }

    if (content?.text) {
      return content.text;
    }

    return "";
  }
}
