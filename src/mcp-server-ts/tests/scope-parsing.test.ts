/**
 * Tests for LLM response scope field parsing
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LLMRuleGenerator } from "../src/core/llm-rule-generator.js";
import { PatternCluster } from "../src/core/pattern-clusterer.js";
import { PatternType } from "../src/core/models.js";

describe("LLM Scope Field Parsing", () => {
  let generator: LLMRuleGenerator;

  beforeEach(() => {
    // Set dummy API key for testing
    process.env.ANTHROPIC_API_KEY = "test-key-12345";
    generator = new LLMRuleGenerator();
  });

  afterEach(() => {
    generator.close();
  });

  describe("parseRuleResponse scope validation", () => {
    it("should parse valid 'global' scope", () => {
      const response = JSON.stringify({
        title: "Validate user input before processing",
        description: "Always validate and sanitize user input to prevent injection attacks.",
        rationale: "Prevents security vulnerabilities and data corruption.",
        scope: "global",
        how_to_apply: ["Check input types", "Sanitize strings"],
        when_to_use: ["Before database operations", "Before rendering output"],
        scenes: { tech: [], business: [], generic: true }
      });

      // Access private method via type assertion for testing
      const parsed = (generator as any).parseRuleResponse(response);

      expect(parsed.scope).toBe("global");
    });

    it("should parse valid 'organization' scope", () => {
      const response = JSON.stringify({
        title: "Use company auth middleware for protected routes",
        description: "Apply CompanyAuth middleware to all API endpoints requiring authentication.",
        rationale: "Ensures consistent authentication across all services.",
        scope: "organization",
        how_to_apply: ["Import Cth", "Add to route middleware stack"],
        when_to_use: ["Protected API routes", "User-specific endpoints"],
        scenes: { tech: ["express", "node"], business: [], generic: false }
      });

      const parsed = (generator as any).parseRuleResponse(response);

      expect(parsed.scope).toBe("organization");
    });

    it("should parse valid 'project' scope", () => {
      const response = JSON.stringify({
        title: "Import types from src/types/common.ts",
        description: "Use shared types from the common types file instead of duplicating definitions.",
        rationale: "Maintains type consistency and reduces duplication.",
        scope: "project",
        how_to_apply: ["Import from src/types/common.ts", "Avoid redefining types"],
        when_to_use: ["When using UserConfig", "When using ApiResponse"],
        scenes: { tech: ["typescript"], business: [], generic: false }
      });

      const parsed = (generator as any).parseRuleResponse(response);

      expect(parsed.scope).toBe("project");
    });

    it("should default to 'global' when scope is missing", () => {
      const response = JSON.stringify({
        title: "Handle errors gracefully",
        description: "Catch and log errors with proper context.",
        rationale: "Improves debugging and user experience.",
        how_to_apply: ["Use try-catch blocks", "Log error details"],
        when_to_use: ["Async operations", "External API calls"],
        scenes: { tech: [], business: [], generic: true }
        // scope field missing
      });

      const parsed = (generator as any).parseRuleResponse(response);

      expect(parsed.scope).toBe("global");
    });

    it("should default to 'global' when scope is invalid", () => {
      const response = JSON.stringify({
        title: "Use proper naming conventions",
        description: "Follow consistent naming patterns for variables and functions.",
        rationale: "Improves code readability.",
        scope: "invalid-scope",  // Invalid value
        how_to_apply: ["Use camelCase for variables", "Use PascalCase for classes"],
        when_to_use: ["Naming new entities"],
        scenes: { tech: [], business: [], generic: true }
      });

      const parsed = (generator as any).parseRuleResponse(response);

      expect(parsed.scope).toBe("global");
    });

    it("should handle scope in markdown code block", () => {
      const response = `\`\`\`json
{
  "title": "Validate API responses",
  "description": "Check API response structure before processing.",
  "rationale": "Prevents runtime errors from malformed data.",
  "scope": "global",
  "how_to_apply": ["Validate response schema", "Handle missing fields"],
  "when_to_use": ["External API calls"],
  "scenes": { "tech": [], "business": [], "generic": true }
}
\`\`\``;

      const parsed = (generator as any).parseRuleResponse(response);

      expect(parsed.scope).toBe("global");
    });
  });

  describe("convertToStorageFormat with scope", () => {
    it("should include scope in indexEntry", () => {
      const rule = {
        id: "rule-001",
        title: "Test Rule",
        description: "Test description",
        rationale: "Test rationale",
        scope: "organization" as const,
        how_to_apply: ["Step 1", "Step 2"],
        when_to_use: ["Condition 1"],
        exceptions: [],
        source_cluster_id: "cluster-1",
        source_signals: ["test", "signal"],
        source_sessions: ["session-1"],
        evidence_count: 3,
        scenes: { tech: ["react"], business: [], generic: false },
        confidence: 0.75,
        priority: "medium" as const,
        created_at: "2026-07-05T10:00:00Z",
        last_validated: "2026-07-05T10:00:00Z"
      };

      const { indexEntry, content } = generator.convertToStorageFormat(rule);

      expect(indexEntry.scope).toBe("organization");
      expect(indexEntry.id).toBe("rule-001");
    });

    it("should handle 'global' scope in storage format", () => {
      const rule = {
        id: "rule-002",
        title: "Global Rule",
        description: "Global description",
        rationale: "Global rationale",
        scope: "global" as const,
        how_to_apply: ["Step 1"],
        when_to_use: ["Always"],
        source_cluster_id: "cluster-2",
        source_signals: ["global"],
        source_sessions: ["session-2"],
        evidence_count: 5,
        scenes: { tech: [], business: [], generic: true },
        confidence: 0.85,
        priority: "high" as const,
        created_at: "2026-07-05T11:00:00Z",
        last_validated: "2026-07-05T11:00:00Z"
      };

      const { indexEntry } = generator.convertToStorageFormat(rule);

      expect(indexEntry.scope).toBe("global");
    });

    it("should handle 'project' scope in storage format", () => {
      const rule = {
        id: "rule-003",
        title: "Project Rule",
        description: "Project description",
        rationale: "Project rationale",
        scope: "project" as const,
        how_to_apply: ["Step 1"],
        when_to_use: ["In this project"],
        source_cluster_id: "cluster-3",
        source_signals: ["project"],
        source_sessions: ["session-3"],
        evidence_count: 2,
        scenes: { tech: ["typescript"], business: [], generic: false },
        confidence: 0.70,
        priority: "low" as const,
        created_at: "2026-07-05T12:00:00Z",
        last_validated: "2026-07-05T12:00:00Z"
      };

      const { indexEntry } = generator.convertToStorageFormat(rule);

      expect(indexEntry.scope).toBe("project");
    });
  });

  describe("Scope in rule content metadata", () => {
    it("should not include scope in content metadata (only in index)", () => {
      const rule = {
        id: "rule-004",
        title: "Test Rule with Scope",
        description: "Test description",
        rationale: "Test rationale",
        scope: "organization" as const,
        how_to_apply: ["Step 1"],
        when_to_use: ["Condition 1"],
        source_cluster_id: "cluster-4",
        source_signals: ["test"],
        source_sessions: ["session-4"],
        evidence_count: 1,
        scenes: { tech: [], business: [], generic: true },
        confidence: 0.60,
        priority: "medium" as const,
        created_at: "2026-07-05T13:00:00Z",
        last_validated: "2026-07-05T13:00:00Z"
      };

      const { content } = generator.convertToStorageFormat(rule);

      // Scope should be in indexEntry, but content.metadata doe't need it
      // (it's used for full-text content storage, not for matching)
      expect(content.id).toBe("rule-004");
      expect(content.title).toBe("Test Rule with Scope");
    });
  });
});
