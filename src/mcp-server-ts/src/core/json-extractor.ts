/**
 * Robust JSON extractor for LLM responses
 *
 * Handles:
 * - Mixed content (text + JSON)
 * - Markdown code fences (```json or ```)
 * - Nested code blocks in JSON content
 * - Multiple JSON objects/arrays
 */

export interface ExtractionResult {
  success: boolean;
  json?: string;
  parsed?: any;
  error?: string;
  strategy?: string;
}

export class JSONExtractor {
  /**
   * Extract and parse JSON from LLM response
   * Uses maximal matching (greedy) to handle nested code blocks
   */
  static extract(response: string): ExtractionResult {
    const trimmed = response.trim();

    if (!trimmed) {
      return { success: false, error: "Empty response" };
    }

    // Build strategy list dynamically based on what the response starts with
    const strategies: Array<{ name: string; fn: (s: string) => string | null }> = [
      { name: "markdown-json-maximal", fn: this.extractMarkdownJsonMaximal },
      { name: "markdown-generic-maximal", fn: this.extractMarkdownGenericMaximal },
    ];

    // Determine whether to try object or array extraction first
    // by checking which bracket appears first in the content
    const firstBrace = trimmed.indexOf('{');
    const firstBracket = trimmed.indexOf('[');

    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      // Array appears first
      strategies.push(
        { name: "json-array-maximal", fn: this.extractJsonArrayMaximal },
        { name: "json-object-maximal", fn: this.extractJsonObjectMaximal }
      );
    } else {
      // Object appears first or only braces found
      strategies.push(
        { name: "json-object-maximal", fn: this.extractJsonObjectMaximal },
        { name: "json-array-maximal", fn: this.extractJsonArrayMaximal }
      );
    }

    strategies.push({ name: "raw", fn: (s: string) => s });

    for (const strategy of strategies) {
      const extracted = strategy.fn.call(this, trimmed);
      if (!extracted) continue;

      const cleaned = this.cleanJson(extracted);

      try {
        const parsed = JSON.parse(cleaned);
        return {
          success: true,
          json: cleaned,
          parsed,
          strategy: strategy.name
        };
      } catch (error) {
        // Continue to next strategy
        continue;
      }
    }

    return {
      success: false,
      error: "All extraction strategies failed",
      json: trimmed.slice(0, 500)
    };
  }

  /**
   * Extract JSON from ```json fence with MAXIMAL matching
   * Finds outermost ``` pair to handle nested code blocks
   */
  private static extractMarkdownJsonMaximal(text: string): string | null {
    const start = text.indexOf("```json");
    if (start === -1) return null;

    // Start after ```json and any whitespace
    let contentStart = start + 7;
    while (contentStart < text.length && /\s/.test(text[contentStart])) {
      contentStart++;
    }

    // Find LAST occurrence of ``` (maximal matching)
    let end = text.lastIndexOf("```");

    // Make sure the end ``` is after the start
    if (end <= start) return null;

    // Extract conteetween ```json and last ```
    const content = text.substring(contentStart, end);

    // Verify it looks like JSON
    const trimmedContent = content.trim();
    if (!trimmedContent.startsWith('{') && !trimmedContent.startsWith('[')) {
      return null;
    }

    return content;
  }

  /**
   * Extract from generic ``` fence with MAXIMAL matching
   */
  private static extractMarkdownGenericMaximal(text: string): string | null {
    const start = text.indexOf("```");
    if (start === -1) return null;

    // Skip the language identifier if present
    let contentStart = start + 3;
    const newlinePos = text.indexOf("\n", contentStart);
    if (newlinePos !== -1 && newlinePos - contentStart < 20) {
      // Likely a language identifier, skip to next line
      contentStart = newlinePos + 1;
    }

    // Find LAST occurrence of ``` (maximal matching)
    let end = text.lastIndexOf("```");

    if (end <= start) return null;

    const content = text.substring(contentStart, end);

    const trimmedContent = content.trim();
    if (!trimmedContent.startsWith('{') && !trimmedContent.startsWith('[')) {
      return null;
    }

    return content;
  }

  /**
   * Extract JSON object with MAXIMAL matching
   * Fermost { } pair with proper brace counting
   */
  private static extractJsonObjectMaximal(text: string): string | null {
    const start = text.indexOf('{');
    if (start === -1) return null;

    // Count braces to find matching closing brace
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') depth++;
      if (char === '}') {
        depth--;
        if (depth === 0) {
          // Found matching closing brace
          return text.substring(start, i + 1);
        }
      }
    }

    return null;
  }

  /**
   * Extract JSON array with MAXIMAL matching
   */
  private static extractJsonArrayMaximal(text: string): string | null {
    const start = text.indexOf('[');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
      const char = text[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '[') depth++;
      if (char === ']') {
        depth--;
        if (depth === 0) {
          return text.substring(start, i + 1);
        }
      }
    }

    return null;
  }

  /**
   * Clean JSON string
   * - Remove NULL and control characters
   * - Fix common LLM artifacts
   * - DO NOT over-escape - preserve valid JSON formatting
   */
  private static cleanJson(json: string): string {
    // Remove problematic control characters (NULL, etc.)
    // Keep newlines, tabs as they're valid in JSON
    let cleaned = json.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Remove BOM if present
    if (cleaned.charCodeAt(0) === 0xFEFF) {
      cleaned = cleaned.slice(1);
    }

    return cleaned.trim();
  }

  /**
   * Validate if string is likely valid JSON
   */
  static looksLikeJson(text: string): boolean {
    const trimmed = text.trim();
    return (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    );
  }

  /**
   * Detect if response is truncated
   */
  static isTruncated(text: string): boolean {
    const trimmed = text.trim();

    // Check if JSON structure is incomplete
    if (trimmed.startsWith('{') && !trimmed.endsWith('}')) return true;
    if (trimmed.startsWith('[') && !trimmed.endsWith(']')) return true;

    // Check for common truncation markers
    const truncationMarkers = [
      '...',
      '[truncated]',
      '[TRUNCATED]',
      '(truncated)',
    ];

    return truncationMarkers.some(marker => trimmed.endsWith(marker));
  }
}
