/**
 * Scope detector for AutoImprove rules.
 *
 * Determines whether rules should be GLOBAL, ORGANIZATION, or PROJECT scoped
 * based on pattern context and session metadata.
 */

import { Pattern, RuleScope } from "./models.js";
import { SessionData } from "./jsonl-parser.js";
import { homedir } from "os";
import { join } from "path";

export interface ScopeContext {
  scope: RuleScope;
  organization_id?: string;
  project_id?: string;
  project_path?: string;
  confidence?: number;
  reason?: string;
}

export class ScopeDetector {
  /**
   * Detect scope for a rule based on pattern and session context
   */
  detectScope(pattern: Pattern, sessionData?: SessionData): ScopeContext {
    // Default to GLOBAL scope
    let scope = RuleScope.GLOBAL;
    let projectPath: string | undefined;
    let projectId: string | undefined;
    let organizationId: string | undefined;

    // Check if pattern comes from a specific project
    if (sessionData?.project_path) {
      projectPath = sessionData.project_path;

      // Shared internal systems and team middleware apply across projects and
      // therefore take precedence over a repository-local hint.
      organizationId = this.detectOrganizationId(projectPath);
      if (this.isOrganizationPattern(pattern) && organizationId) {
        scope = RuleScope.ORGANIZATION;
      } else if (this.isProjectSpecificPattern(pattern, projectPath)) {
        scope = RuleScope.PROJECT;
        projectId = this.extractProjectId(projectPath);
      }
    }

    return {
      scope,
      organization_id: organizationId,
      project_path: projectPath,
      project_id: projectId,
      confidence: scope === RuleScope.GLOBAL ? 0.65 : 0.55,
      reason: scope === RuleScope.PROJECT
        ? "Project-specific context detected by heuristic analysis"
        : scope === RuleScope.ORGANIZATION
          ? "Organization path and shared tooling indicators detected"
          : "No project-only dependency detected; treated as broadly applicable"
    };
  }

  /**
   * Check if pattern is project-specific or globally applicable
   */
  private isProjectSpecificPattern(pattern: Pattern, projectPath: string): boolean {
    // Check pattern context for project-specific indicators
    const contextLower = pattern.occurrences
      .map(o => o.context?.toLowerCase() || "")
      .join(" ");

    // Global patterns (universally applicable)
    const globalIndicators = [
      // Programming principles
      "dry principle",
      "single responsibility",
      "solid principle",
      "design pattern",

      // Common security issues
      "sql injection",
      "xss",
      "csrf",
      "authentication",
      "authorization",

      // Performance patterns
      "memory leak",
      "race condition",
      "deadlock",

      // Universal style/conventions
      "naming convention",
      "log level",
      "error handling"
    ];

    if (globalIndicators.some(indicator => contextLower.includes(indicator))) {
      return false;  // Global pattern
    }

    // Project-specific indicators
    const projectSpecificIndicators = [
      // Specific file/module references
      projectPath.replace(/\\/g, "/").split("/").pop() || "",  // Project name

      // Framework/library combinations unique to this project
      "custom implementation",
      "project-specific",

      // References to project structure
      "this repository",
      "this codebase",
      "this project"
    ];

    // Check if pattern mentions project-specific modules or files
    const hasProjectReferences = pattern.occurrences.some(o => {
      const userInput = o.user_input?.toLowerCase() || "";
      const context = o.context?.toLowerCase() || "";

      return projectSpecificIndicators.some(indicator =>
        userInput.includes(indicator) || context.includes(indicator)
      );
    });

    // Heuristic: If pattern has high occurrence count (5+) within single project,
    // but references generic concepts, it's likely still global
    if (pattern.occurrences.length >= 5 && !hasProjectReferences) {
      return false;  // Global pattern
    }

    // Heuristic: If pattern has low occurrence count (1-2) and specific context,
    // it's likely project-specific
    if (pattern.occurrences.length <= 2 && hasProjectReferences) {
      return true;  // Project-specific
    }

    // Default: if we have a project path and no clear global indicators,
    // lean toward project-specific for safety
    // Users can manually adjust scope if needed
    return hasProjectReferences;
  }

  private isOrganizationPattern(pattern: Pattern): boolean {
    const text = [pattern.description, ...pattern.occurrences.map(o => `${o.user_input || ""} ${o.context || ""}`)]
      .join(" ").toLowerCase();
    return [
      "our team", "company standard", "organization", "org-wide", "internal",
      "shared middleware", "internal service", "internal system", "company library",
      "company package", "private package", "internal api", "shared tooling"
    ].some(indicator => text.includes(indicator));
  }

  /**
   * Extract project identifier from project path
   */
  private extractProjectId(projectPath: string): string {
    // Use the last component of the path as project ID
    const parts = projectPath.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] || "unknown-project";
  }

  /**
   * Detect organization ID from project path
   *
   * This is a heuristic - organizations can customize this logic
   */
  detectOrganizationId(projectPath: string): string | undefined {
    // Example: /Users/username/work/mycompany/project -> mycompany
    // Example: /home/dev/github.com/orgname/repo -> orgname

    const parts = projectPath.replace(/\\/g, "/").split("/").filter(Boolean);

    // Look for common organization path patterns
    const orgKeywords = ["work", "github.com", "gitlab.com", "company", "org"];

    for (let i = 0; i < parts.length - 1; i++) {
      if (orgKeywords.includes(parts[i])) {
        return parts[i + 1];  // Next part is likely org name
      }
    }

    return undefined;
  }

  /**
   * Check if two project paths refer to the same project
   */
  isSameProject(path1: string, path2: string): boolean {
    // Exact match
    if (path1 === path2) return true;

    // Normalize paths (remove trailing slashes)
    const normalized1 = path1.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalized2 = path2.replace(/\\/g, "/").replace(/\/+$/, "");

    if (normalized1 === normalized2) return true;

    // Check if one is a subpath of the other
    // (e.g., /path/to/project matches /path/to/project/src)
    return normalized1.startsWith(normalized2) || normalized2.startsWith(normalized1);
  }

  /**
   * Get current project path from CWD or other sources
   */
  getCurrentProjectPath(): string | undefined {
    // In MCP server context, we don't have access to CWD
    // This would need to be passed from the calling context
    return process.cwd();
  }
}
