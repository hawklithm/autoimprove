/**
 * Tests for JSONExtractor - robust JSON extraction from LLM responses
 */

import { describe, it, expect } from "vitest";
import { JSONExtractor } from "../src/core/json-extractor.js";

describe("JSONExtractor", () => {
  describe("Maximal matching for nested code blocks", () => {
    it("should extract JSON with nested ``` code blocks in content", () => {
      const response = `
Here's the analysis:

\`\`\`json
{
  "title": "Handle code blocks in examples",
  "description": "When showing examples, code may contain \`\`\` markers",
  "examples": "Example: \`\`\`python\\nprint('hello')\\n\`\`\`",
  "nested": "This has \`\`\` inside"
}
\`\`\`

That's the result.
      `.trim();

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed).toBeDefined();
      expect(result.parsed.title).toBe("Handle code blocks in examples");
      expect(result.strategy).toBe("markdown-json-maximal");
    });

    it("should handle the user's example with nested markdown", () => {
      const response = `Looking at these patterns, I can identify two distinct issues:

**Pattern Analysis:**
- **Patterns 1, 3, 4**: JSON parsing failures when processing LLM responses

\`\`\`json
[
  {
    "title": "Extract and validate JSON from mixed-content LLM responses robustly",
    "description": "When parsing LLM responses that may contain JSON...",
    "how_to_apply": [
      "Before JSON.parse(), check if response contains non-JSON content",
      "Example: Look for markers like \`\`\`json in the response"
    ],
    "rationale": "LLM responses are unpredictable"
  }
]
\`\`\``;

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed).toBeInstanceOf(Array);
      expect(result.parsed[0].title).toContain("Extract and validate JSON");
    });

    it("should use maximal matching - not stop at first ```", () => {
      const response = `
\`\`\`json
{
  "data": "This contains \`\`\` in the middle",
  "value": 123
}
\`\`\`
      `.trim();

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed.data).toContain("```");
      expect(result.parsed.value).toBe(123);
    });
  });

  describe("Mixed content extraction", () => {
    it("should extract JSON from response with leading text", () => {
      const response = `Based on the analysis, here's the rule:

\`\`\`json
{"title": "Test Rule", "confidence": 0.85}
\`\`\`

This rule addresses the pattern.`;

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed.title).toBe("Test Rule");
    });

    it("should extract JSON without markdown fences", () => {
      const response = `{"title": "Direct JSON", "value": true}`;

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed.title).toBe("Direct JSON");
      expect(result.strategy).toBe("json-object-maximal");
    });

    it("should extract array without markdown fences", () => {
      const response = `[{"id": 1}, {"id": 2}]`;

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed).toHaveLength(2);
      expect(result.strategy).toBe("json-array-maximal");
    });

    it("should handle generic code fences without 'json' tag", () => {
      const response = `
\`\`\`
{
  "title": "Generic fence",
  "works": true
}
\`\`\`
      `.trim();

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed.works).toBe(true);
      expect(result.strategy).toBe("markdown-generic-maximal");
    });
  });

  describe("Brace counting for maximal matching", () => {
    it("should correctly count nested braces", () => {
      const response = `
{
  "outer": {
    "inner": {
      "deep": "value"
    }
  },
  "array": [{"a": 1}, {"b": 2}]
}
Some trailing text
      `.trim();

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed.outer.inner.deep).toBe("value");
      expect(result.parsed.array).toHaveLength(2);
    });

    it("should handle arrays with nested objects", () => {
      const response = `
[
  {
    "item": {
      "nested": [1, 2, 3]
    }
  }
]
      `.trim();

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed[0].item.nested).toEqual([1, 2, 3]);
    });
  });

  describe("String handling", () => {
    it("should not be confused by braces in strings", () => {
      const response = `
{
  "template": "Use {variable} and {another}",
  "code": "if (x) { return '}'; }"
}
      `.trim();

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed.template).toContain("{variable}");
      expect(result.parsed.code).toContain("return '}'");
    });

    it("should handle escaped quotes in strings", () => {
      const response = `
{
  "message": "She said \\"hello\\" to me",
  "path": "C:\\\\Users\\\\test"
}
      `.trim();

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed.message).toContain('"hello"');
    });
  });

  describe("Truncation detection", () => {
    it("should detect incomplete JSON object", () => {
      const incomplete = `{"title": "Test", "data":`;

      expect(JSONExtractor.isTruncated(incomplete)).toBe(true);
    });

    it("should detect incomplete JSON array", () => {
      const incomplete = `[{"id": 1}, {"id": 2`;

      expect(JSONExtractor.isTruncated(incomplete)).toBe(true);
    });

    it("should not flag complete JSON as truncated", () => {
      const complete = `{"title": "Complete", "done": true}`;

      expect(JSONExtractor.isTruncated(complete)).toBe(false);
    });

    it("should detect ellipsis markers", () => {
      const withEllipsis = `{"data": "value"}...`;

      expect(JSONExtractor.isTruncated(withEllipsis)).toBe(true);
    });
  });

  describe("Control character handling", () => {
    it("should remove NULL bytes", () => {
      const withNull = `{"title": "Test\x00Value"}`;

      const result = JSONExtractor.extract(withNull);

      expect(result.success).toBe(true);
      expect(result.parsed.title).toBe("TestValue");
    });

    it("should preserve newlines and tabs in JSON (as actual characters, not escapes)", () => {
      const withWhitespace = `{
  "multiline": "Line 1\\nLine 2",
  "indented": "\\tTabbed"
}`;

      const result = JSONExtractor.extract(withWhitespace);

      expect(result.success).toBe(true);
      // JSON.parse converts \\n to actual newline character
      expect(result.parsed.multiline).toContain("\n");
      expect(result.parsed.indented).toContain("\t");
    });

    it("should remove BOM if present", () => {
      const withBOM = "﻿" + `{"title": "With BOM"}`;

      const result = JSONExtractor.extract(withBOM);

      expect(result.success).toBe(true);
      expect(result.parsed.title).toBe("With BOM");
    });
  });

  describe("Error cases", () => {
    it("should return error for empty response", () => {
      const result = JSONExtractor.extract("");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Empty response");
    });

    it("should return error for non-JSON content", () => {
      const result = JSONExtractor.extract("This is just plain text, no JSON here.");

      expect(result.success).toBe(false);
      expect(result.error).toBe("All extraction strategies failed");
    });

    it("should return error for malformed JSON", () => {
      const result = JSONExtractor.extract(`{invalid: json without quotes}`);

      expect(result.success).toBe(false);
    });
  });

  describe("Lenient repair (repairAndParse)", () => {
    it("should repair an unterminated key (missing closing quote + colon)", () => {
      // Reproduces the real-world LLM defect: "rationale "Incomplete...
      const broken = `[
  {
    "title": "Complete rule",
    "description": "Include all fields",
    "rationale "Incomplete rules force users to manually add missing fields.",
    "scope": "global"
  }
]`;

      const result = JSONExtractor.repairAndParse(broken);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe("repair");
      expect(result.parsed).toBeInstanceOf(Array);
      expect(result.parsed[0].rationale).toContain("Incomplete rules");
    });

    it("should repair trailing commas before } and ]", () => {
      const broken = `{
  "title": "Rule with trailing comma",
  "done": true,
}`;

      const result = JSONExtractor.repairAndParse(broken);

      expect(result.success).toBe(true);
      expect(result.parsed.title).toBe("Rule with trailing comma");
      expect(result.parsed.done).toBe(true);
    });

    it("should quote unquoted object keys", () => {
      const broken = `{invalid: "json without quotes"}`;

      const result = JSONExtractor.repairAndParse(broken);

      expect(result.success).toBe(true);
      expect(result.parsed.invalid).toBe("json without quotes");
    });

    it("should return success:false when JSON is truly unrecoverable", () => {
      const result = JSONExtractor.repairAndParse("this is not json at all");

      expect(result.success).toBe(false);
      expect(result.error).toBe("All repair strategies failed");
    });
  });

  describe("extractRaw", () => {
    it("should return the raw JSON candidate even when it cannot be parsed", () => {
      const broken = `[
  {
    "title": "Complete rule",
    "rationale "Incomplete rules."
  }
]`;

      const raw = JSONExtractor.extractRaw(broken);

      expect(raw).not.toBeNull();
      expect(raw).toContain('"rationale "Incomplete rules."');
    });

    it("should return null for empty input", () => {
      expect(JSONExtractor.extractRaw("")).toBeNull();
    });
  });

  describe("Helper: looksLikeJson", () => {
    it("should identify object-like strings", () => {
      expect(JSONExtractor.looksLikeJson(`{"a": 1}`)).toBe(true);
      expect(JSONExtractor.looksLikeJson(`  { "a": 1 }  `)).toBe(true);
    });

    it("should identify array-like strings", () => {
      expect(JSONExtractor.looksLikeJson(`[1, 2, 3]`)).toBe(true);
      expect(JSONExtractor.looksLikeJson(`  [ ]  `)).toBe(true);
    });

    it("should reject non-JSON-like strings", () => {
      expect(JSONExtractor.looksLikeJson(`plain text`)).toBe(false);
      expect(JSONExtractor.looksLikeJson(`{incomplete`)).toBe(false);
      expect(JSONExtractor.looksLikeJson(`[incomplete`)).toBe(false);
    });
  });

  describe("Real-world edge cases", () => {
    it("should handle LLM response with explanation + code fence", () => {
      const response = `I've analyzed the patterns and here's what I found:

The patterns indicate a need for robust JSON parsing. Here's the rule:

\`\`\`json
{
  "title": "Robust JSON extraction",
  "description": "Always use try-catch when parsing LLM responses",
  "rationale": "LLM outputs are unpredictable"
}
\`\`\`

This should help prevent future parsing errors.`;

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed.title).toBe("Robust JSON extraction");
    });

    it("should handle response with multiple code blocks (use first valid JSON)", () => {
      const response = `
Example of bad code:
\`\`\`javascript
const data = require('./data.json');
\`\`\`

Here's the rule:
\`\`\`json
{"title": "Use async imports", "priority": "high"}
\`\`\`
      `.trim();

      const result = JSONExtractor.extract(response);

      expect(result.success).toBe(true);
      expect(result.parsed.title).toBe("Use async imports");
    });
  });
});
