/**
 * Proactive rule loading via MCP Resources
 *
 * Registers high-priority rules as MCP resources that Claude Code
 * automatically loads into context at session start, enabling
 * "automatic" rule application without explicit tool calls.
 *
 * Design:
 * - Resource URI: autoimprove://rules/proactive/{scene}
 * - Auto-detected scene from cwd/file context
 * - Only high-confidence (>0.7) + high-priority rules
 * - Regenerated when rules change (via export trigger)
 */

import { RuleIndexManager } from "../storage/rule-index.js";
import { RuleContentManager } from "../storage/rule-content.js";
import { EnhancedSceneDetector } from "../core/enhanced-scene-detector.js";
import { createScene, Scene, RuleScope } from "../core/models.js";
import { UNIFIED_RULE_MIN_SCORE } from "../core/rule-quality.js";
import { logger } from "../core/logger.js";

export interface ProactiveRuleResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  content: string;
}

export class ProactiveRuleResourceProvider {
  constructor(
    private indexManager: RuleIndexManager,
    private contentManager: RuleContentManager,
    private sceneDetector: EnhancedSceneDetector
  ) {}

  /**
   * List available proactive rule resources.
   * Returns scene-specific rule bundles for common tech stacks.
   */
  listResources(): ProactiveRuleResource[] {
    const resources: ProactiveRuleResource[] = [];

    // Get all high-confidence, high-priority rules
    const allRules = this.filterScopedRules(this.indexManager.listRules({
      minConfidence: UNIFIED_RULE_MIN_SCORE,
      priorityFilter: "high",
    }));

    if (allRules.length === 0) {
      return resources;
    }

    // Group by primary tech scene
    const rulesByTech = new Map<string, typeof allRules>();

    for (const rule of allRules) {
      if (rule.scenes?.tech && rule.scenes.tech.length > 0) {
        const primaryTech = rule.scenes.tech[0]; // Use first tech as primary
        if (!rulesByTech.has(primaryTech)) {
          rulesByTech.set(primaryTech, []);
        }
        rulesByTech.get(primaryTech)!.push(rule);
      }
    }

    // Create resource for each tech scene (limit to top 5 most common)
    const sortedTechs = Array.from(rulesByTech.entries())
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);

    for (const [tech, rules] of sortedTechs) {
      resources.push({
        uri: `autoimprove://rules/proactive/${tech}`,
        name: `AutoImprove Rules: ${tech}`,
        description: `High-priority coding rules for ${tech} (${rules.length} rules, auto-loaded)`,
        mimeType: "text/markdown",
        content: this.formatRulesAsMarkdown(rules, tech),
      });
    }

    // Also create a "general" resource for non-tech-specific rules
    const generalRules = allRules.filter(
      (r) => !r.scenes?.tech || r.scenes.tech.length === 0
    );

    if (generalRules.length > 0) {
      resources.push({
        uri: "autoimprove://rules/proactive/general",
        name: "AutoImprove Rules: General",
        description: `General cod rules (${generalRules.length} rules, auto-loaded)`,
        mimeType: "text/markdown",
        content: this.formatRulesAsMarkdown(generalRules, "general"),
      });
    }

    logger.info("proactive-rules", `Generated ${resources.length} proactive rule resources`);
    return resources;
  }

  /**
   * Read a specific proactive rule resource by URI.
   */
  async readResource(uri: string): Promise<string> {
    // Parse URI: autoimprove://rules/proactive/{scene}
    const match = uri.match(/^autoimprove:\/\/rules\/proactive\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid resource URI: ${uri}`);
    }

    const scene = match[1];

    // Get rules for this scene
    const allRules = this.filterScopedRules(this.indexManager.listRules({
      minConfidence: UNIFIED_RULE_MIN_SCORE,
      priorityFilter: "high",
    }));

    let rules: typeof allRules = [];

    if (scene === "general") {
      rules = allRules.filter(
        (r) => !r.scenes?.tech || r.scenes.tech.length === 0
      );
    } else {
      rules = allRules.filter(
        (r) => r.scenes?.tech && r.scenes.tech.includes(scene)
      );
    }

    return this.formatRulesAsMarkdown(rules, scene);
  }

  /**
   * Do not expose project/team rules as global proactive context. The MCP
   * resource layer has no request payload, so use explicit environment
   * context when available and fail closed for scoped rules otherwise.
   */
  private filterScopedRules<T extends {
    scope?: RuleScope;
    status?: string;
    scope_context?: { project_path?: string; organization_id?: string; team_id?: string; repository?: string; branch?: string };
  }>(rules: T[]): T[] {
    const projectPath = process.env.AUTOIMPROVE_PROJECT_PATH
      ? this.normalizePath(process.env.AUTOIMPROVE_PROJECT_PATH)
      : undefined;
    const organizationId = process.env.AUTOIMPROVE_ORGANIZATION_ID?.trim().toLowerCase();
    const teamId = process.env.AUTOIMPROVE_TEAM_ID?.trim();
    const repository = process.env.AUTOIMPROVE_REPOSITORY?.trim();
    const branch = process.env.AUTOIMPROVE_BRANCH?.trim();

    return rules.filter((rule) => {
      const scope = rule.scope || RuleScope.GLOBAL;
      if (rule.status && rule.status !== "active") return false;
      if (scope === RuleScope.GLOBAL) return true;

      if (scope === RuleScope.ORGANIZATION) {
        const ruleOrganization = rule.scope_context?.organization_id?.trim().toLowerCase();
        if (ruleOrganization && (!organizationId || organizationId !== ruleOrganization)) return false;
        if (rule.scope_context?.team_id && rule.scope_context.team_id !== teamId) return false;
        if (rule.scope_context?.repository && rule.scope_context.repository !== repository) return false;
        if (rule.scope_context?.branch && rule.scope_context.branch !== branch) return false;
        return true;
      }

      const ruleProject = rule.scope_context?.project_path
        ? this.normalizePath(rule.scope_context.project_path)
        : undefined;
      if (!projectPath || !ruleProject) return false;
      return projectPath === ruleProject
        || projectPath.startsWith(`${ruleProject}/`)
        || ruleProject.startsWith(`${projectPath}/`);
    });
  }

  private normalizePath(value: string): string {
    return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }

  /**
   * Format rules as markdown for Claude's context.
   * Compact format: 1 rule = ~100-150 tokens.
   * Budget: max 500 tokens per scene to prevent context pollution.
   */
  private formatRulesAsMarkdown(rules: any[], scene: string): string {
    const lines: string[] = [];
    const TOKEN_BUDGET = 500; // Max tokens per scene resource
    let currentTokens = 0;

    lines.push(`# AutoImprove Learned Rules — ${scene}`);
    lines.push("");
    lines.push(`> 🤖 Auto-loaded ${rules.length} high-priority rules. Apply these automatically when relevant.`);
    lines.push("");

    currentTokens += this.estimateTokens(lines.join("\n"));

    // Sort by priority (critical > high) then confidence
    const sorted = rules.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const aPrio = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 2;
      const bPrio = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 2;
      if (aPrio !== bPrio) return aPrio - bPrio;
      return b.confidence - a.confidence;
    });

    let rulesIncluded = 0;

    for (const rule of sorted) {
      // Check token budget before adding rule
      const rulePreview = this.formatSingleRule(rule);
      const ruleTokens = this.estimateTokens(rulePreview);

      if (currentTokens + ruleTokens > TOKEN_BUDGET && rulesIncluded > 0) {
        // Budget exceeded, stop adding rules
        lines.push(`_...and ${sorted.length - rulesIncluded} more rules (omitted to preserve context budget)_`);
        lines.push("");
        break;
      }

      // Add the rule
      lines.push(rulePreview);
      currentTokens += ruleTokens;
      rulesIncluded++;
    }

    // Only add footer if we didn't already add rules
    if (rulesIncluded === 0) {
      return this.formatEmptyResource(scene);
    }

    lines.push("## Usage");
    lines.push("");
    lines.push("- Apply these rules automatically when starting relevant tasks");
    lines.push("- Mention rule ID when applying (e.g., 'Following RULE-010...')");
    lines.push("- Call `record_feedback` if a rule doesn't fit the current scenario");
    lines.push("- Critical (🔴) rules are MANDATORY; High (🟠) rules should be followed unless user says otherwise");

    return lines.join("\n");
  }

  /**
   * Format a single rule as markdown.
   */
  private formatSingleRule(rule: any): string {
    const lines: string[] = [];

    const priorityEmoji = {
      critical: "🔴",
      high: "🟠",
      medium: "🟡",
      low: "⚪",
    }[rule.priority as 'critical' | 'high' | 'medium' | 'low'] || "⚪";

    lines.push(`## ${priorityEmoji} ${rule.id} — ${this.extractTitle(rule)}`);
    lines.push("");

    // Load full content
    const ruleContent = this.contentManager.loadContent(rule.id);
    if (ruleContent) {
      const sections = this.parseRuleContent(ruleContent.content);

      // Description (mandatory)
      if (sections.description) {
        lines.push(`**What**: ${sections.description}`);
        lines.push("");
      }

      // Rationale (why it matters)
      if (sections.rationale) {
        lines.push(`**Why**: ${sections.rationale}`);
        lines.push("");
      }

      // How to apply (action items)
      if (sections.howTo) {
        lines.push(`**How**: ${sections.howTo}`);
        lines.push("");
      }

      // When to use (context)
      if (sections.whenToUse) {
        lines.push(`**When**: ${sections.whenToUse}`);
        lines.push("");
      }

      // Examples (if compact)
      if (sections.examples && sections.examples.length < 500) {
        lines.push(`**Example**:`);
        lines.push("```");
        lines.push(sections.examples);
        lines.push("```");
        lines.push("");
      }
    }

    lines.push(`_Confidence: ${(rule.confidence * 100).toFixed(0)}% | Scenes: ${this.formatScenes(rule.scenes)}_`);
    lines.push("");
    lines.push("---");
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Estimate token count (rough approximation: 1 token ≈ 4 chars).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Format empty resource when no rules fit budget.
   */
  private formatEmptyResource(scene: string): string {
    return `# AutoImprove Learned Rules — ${scene}\n\n> No high-priority rules available for this scene yet. Use \`search_knowledge\` to find relevant patterns.\n`;
  }

  /**
   * Extract rule title from content or ID.
   */
  private extractTitle(rule: any): string {
    const ruleContent = this.contentManager.loadContent(rule.id);
    if (!ruleContent) return rule.id;

    // Use structured title if available
    if (ruleContent.title) return ruleContent.title;

    // Try to extract first heading from content
    const match = ruleContent.content.match(/^#\s+(.+)$/m);
    if (match) return match[1];

    // Fallback: first line
    const firstLine = ruleContent.content.split("\n")[0];
    return firstLine.slice(0, 60);
  }

  /**
   * Parse rule content into sections.
   */
  private parseRuleContent(content: string): {
    description?: string;
    rationale?: string;
    howTo?: string;
    examples?: string;
    whenToUse?: string;
  } {
    const sections: any = {};

    // Simple section extraction by headers
    const descMatch = content.match(/##\s+Description\s*\n+([\s\S]+?)(?=##|$)/);
    if (descMatch) sections.description = descMatch[1].trim();

    const rationaleMatch = content.match(/##\s+Rationale\s*\n+([\s\S]+?)(?=##|$)/);
    if (rationaleMatch) sections.rationale = rationaleMatch[1].trim();

    const howToMatch = content.match(/##\s+How to apply\s*\n+([\s\S]+?)(?=##|$)/);
    if (howToMatch) sections.howTo = howToMatch[1].trim();

    const examplesMatch = content.match(/##\s+Examples\s*\n+([\s\S]+?)(?=##|$)/);
    if (examplesMatch) sections.examples = examplesMatch[1].trim();

    const whenMatch = content.match(/##\s+When to use\s*\n+([\s\S]+?)(?=##|$)/);
    if (whenMatch) sections.whenToUse = whenMatch[1].trim();

    return sections;
  }

  /**
   * Format scene tags for display.
   */
  private formatScenes(scenes: Scene | undefined): string {
    if (!scenes) return "general";

    const parts: string[] = [];
    if (scenes.tech?.length) parts.push(scenes.tech.join(", "));
    if (scenes.functional?.length) parts.push(scenes.functional.join(", "));
    if (scenes.business?.length) parts.push(scenes.business.join(", "));

    return parts.join(" • ") || "general";
  }
}
