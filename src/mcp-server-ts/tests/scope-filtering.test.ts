/**
 * Test scope filtering functionality
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RuleScope, RuleIndexEntry, createScene } from "../src/core/models.js";
import { RuleMatcher } from "../src/core/rule-matcher.js";
import { RuleIndexManager } from "../src/storage/rule-index.js";
import { ScopeDetector } from "../src/core/scope-detector.js";
import { SessionData } from "../src/core/jsonl-parser.js";

describe("Scope Filtering", () => {
  let indexManager: RuleIndexManager;
  let matcher: RuleMatcher;
  let scopeDetector: ScopeDetector;

  beforeEach(() => {
    // Use test environment variable to use separate storage
    process.env.AUTOIMPROVE_STORAGE_ROOT = "/tmp/autoimprove-test-scope";

    indexManager = new RuleIndexManager();
    matcher = new RuleMatcher(indexManager);
    scopeDetector = new ScopeDetector();

    // Clear all existing rules by saving empty index
    indexManager.saveIndex({ version: "1.0", rules: [] });
  });

  describe("Scope Detection", () => {
    it("should detect GLOBAL scope for universal patterns", () => {
      const pattern = {
        type: "repeated-correction" as const,
        description: "Use async/await instead of callbacks for better readability",
        occurrences: [
          {
            session_id: "test",
            timestamp: "2024-01-01",
            user_action: "explicit_correction" as const,
            context: "Improved error handling with async/await"
          }
        ],
        first_seen: "2024-01-01",
        last_seen: "2024-01-01",
        confidence: 0.8,
        keywords: ["async", "await"]
      };

      const sessionData: SessionData = {
        session_id: "test",
        messages: [],
        tool_calls: [],
        metadata: {},
        project_path: "/Users/test/project"
      };

      const scopeContext = scopeDetector.detectScope(pattern, sessionData);
      expect(scopeContext.scope).toBe(RuleScope.GLOBAL);
    });

    it("should detect PROJECT scope for project-specific patterns", () => {
      const pattern = {
        type: "repeated-correction" as const,
        description: "Use custom implementation for validation",
        occurrences: [
          {
            session_id: "test",
            timestamp: "2024-01-01",
            user_action: "explicit_correction" as const,
            context: "This project requires custom validation",
            user_input: "Use project-specific validation helper"
          }
        ],
        first_seen: "2024-01-01",
        last_seen: "2024-01-01",
        confidence: 0.7,
        keywords: []
      };

      const sessionData: SessionData = {
        session_id: "test",
        messages: [],
        tool_calls: [],
        metadata: {},
        project_path: "/Users/test/myproject"
      };

      const scopeContext = scopeDetector.detectScope(pattern, sessionData);
      expect(scopeContext.scope).toBe(RuleScope.PROJECT);
      expect(scopeContext.project_path).toBe("/Users/test/myproject");
      expect(scopeContext.project_id).toBe("myproject");
    });
  });

  describe("Scope-based Rule Filtering", () => {
    beforeEach(() => {
      // Add global rule
      indexManager.addRule({
        id: "rule-001",
        type: "repeated-correction",
        priority: "high",
        confidence: 0.8,
        scenes: createScene({ tech: ["react"], functional: ["validation"] }),
        keywords: ["async", "validation"],
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
        scope: RuleScope.GLOBAL
      });

      // Add project-scoped rule
      indexManager.addRule({
        id: "rule-002",
        type: "preference",
        priority: "medium",
        confidence: 0.7,
        scenes: createScene({ tech: ["react"], functional: ["auth"] }),
        keywords: ["auth", "token"],
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
        scope: RuleScope.PROJECT,
        scope_context: {
          project_path: "/Users/test/projectA",
          project_id: "projectA"
        }
      });

      // Add another project-scoped rule
      indexManager.addRule({
        id: "rule-003",
        type: "anti-pattern",
        priority: "high",
        confidence: 0.9,
        scenes: createScene({ tech: ["react"], functional: ["state"] }),
        keywords: ["state", "mutation"],
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
        scope: RuleScope.PROJECT,
        scope_context: {
          project_path: "/Users/test/projectB",
          project_id: "projectB"
        }
      });

      // Add organization-scoped rule
      indexManager.addRule({
        id: "rule-004",
        type: "security",
        priority: "critical",
        confidence: 0.95,
        scenes: createScene({ tech: ["react"], functional: ["api"] }),
        keywords: ["security", "api"],
        created_at: "2024-01-01",
        updated_at: "2024-01-01",
        scope: RuleScope.ORGANIZATION,
        scope_context: {
          organization_id: "mycompany"
        }
      });
    });

    it("should return all rules when no scope filter is provided", () => {
      const scene = createScene({ tech: ["react"], functional: [] });
      const matches = matcher.matchRules(scene);

      expect(matches.length).toBe(4); // All rules match
    });

    it("should filter by GLOBAL scope only", () => {
      const scene = createScene({ tech: ["react"], functional: [] });
      const matches = matcher.matchRules(scene, undefined, undefined, undefined, {
        scopes: [RuleScope.GLOBAL]
      });

      expect(matches.length).toBe(1);
      expect(matches[0].rule.id).toBe("rule-001");
    });

    it("should filter by PROJECT scope and match current project", () => {
      const scene = createScene({ tech: ["react"], functional: [] });
      const matches = matcher.matchRules(scene, undefined, undefined, undefined, {
        scopes: [RuleScope.PROJECT],
        current_project: "/Users/test/projectA"
      });

      expect(matches.length).toBe(1);
      expect(matches[0].rule.id).toBe("rule-002");
    });

    it("should filter by PROJECT scope and exclude other projects", () => {
      const scene = createScene({ tech: ["react"], functional: [] });
      const matches = matcher.matchRules(scene, undefined, undefined, undefined, {
        scopes: [RuleScope.PROJECT],
        current_project: "/Users/test/projectB"
      });

      expect(matches.length).toBe(1);
      expect(matches[0].rule.id).toBe("rule-003");
    });

    it("should include GLOBAL + PROJECT scopes", () => {
      const scene = createScene({ tech: ["react"], functional: [] });
      const matches = matcher.matchRules(scene, undefined, undefined, undefined, {
        scopes: [RuleScope.GLOBAL, RuleScope.PROJECT],
        current_project: "/Users/test/projectA"
      });

      expect(matches.length).toBe(2);
      const ruleIds = matches.map(m => m.rule.id).sort();
      expect(ruleIds).toEqual(["rule-001", "rule-002"]);
    });

    it("should filter by ORGANIZATION scope", () => {
      const scene = createScene({ tech: ["react"], functional: [] });
      const matches = matcher.matchRules(scene, undefined, undefined, undefined, {
        scopes: [RuleScope.ORGANIZATION],
        organization_id: "mycompany"
      });

      expect(matches.length).toBe(1);
      expect(matches[0].rule.id).toBe("rule-004");
    });

    it("should include all scopes (default behavior)", () => {
      const scene = createScene({ tech: ["react"], functional: [] });
      const matches = matcher.matchRules(scene, undefined, undefined, undefined, {
        scopes: [RuleScope.GLOBAL, RuleScope.ORGANIZATION, RuleScope.PROJECT],
        current_project: "/Users/test/projectA",
        organization_id: "mycompany"
      });

      expect(matches.length).toBe(3); // global + projectA + org
      const ruleIds = matches.map(m => m.rule.id).sort();
      expect(ruleIds).toEqual(["rule-001", "rule-002", "rule-004"]);
    });

    it("should handle substring project path matching", () => {
      const scene = createScene({ tech: ["react"], functional: [] });

      // Match with subdirectory
      const matches = matcher.matchRules(scene, undefined, undefined, undefined, {
        scopes: [RuleScope.PROJECT],
        current_project: "/Users/test/projectA/src"
      });

      expect(matches.length).toBe(1);
      expect(matches[0].rule.id).toBe("rule-002");
    });
  });

  describe("ScopeDetector utilities", () => {
    it("should extract project ID from path", () => {
      const detector = new ScopeDetector();
      const projectId = detector["extractProjectId"]("/Users/test/workspace/myproject");
      expect(projectId).toBe("myproject");
    });

    it("should detect organization ID from path", () => {
      const detector = new ScopeDetector();
      const orgId = detector.detectOrganizationId("/Users/test/work/mycompany/project");
      expect(orgId).toBe("mycompany");
    });

    it("should check if two projects are the same", () => {
      const detector = new ScopeDetector();

      expect(detector.isSameProject("/path/to/project", "/path/to/project")).toBe(true);
      expect(detector.isSameProject("/path/to/project", "/path/to/project/")).toBe(true);
      expect(detector.isSameProject("/path/to/project", "/path/to/project/src")).toBe(true);
      expect(detector.isSameProject("/path/to/projectA", "/path/to/projectB")).toBe(false);
    });
  });
});
