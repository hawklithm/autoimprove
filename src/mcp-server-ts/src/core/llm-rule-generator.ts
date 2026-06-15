/**
 * LLM-based rule generator - generates rules from pattern clusters
 */

import Anthropic from "@anthropic-ai/sdk";
import { SignalDictionaryDB, LabeledContent } from "../storage/signal-dictionary-db.js";
import { PatternCluster } from "./pattern-clusterer.js";
import { PatternType, Priority, RuleIndexEntry, RuleContent } from "./models.js";

export interface GeneratedRule {
  id: string;
  title: string;
  description: string;
  rationale: string;
  how_to_apply: string[];
  examples?: {
    bad?: string;
    good: string;
    explanation: string;
  };
  when_to_use: string[];
  exceptions?: string[];
  related_patterns?: string[];
  source_cluster_id: string;
  source_signals: string[];
  source_sessions: string[];
  evidence_count: number;
  scenes: {
    tech: string[];
    business: string[];
    generic: boolean;
  };
  confidence: number;
  priority: "critical" | "high" | "medium" | "low";
  created_at: string;
  last_validated: string;
}

export class LLMRuleGenerator {
  private db: SignalDictionaryDB;
  private anthropic: Anthropic;

  constructor() {
    this.db = new SignalDictionaryDB();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required");
    }

    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Generate rule from pattern cluster using LLM
   */
  async generateRule(cluster: PatternCluster, ruleId: string): Promise<GeneratedRule> {
    // Load full content for cluster
    const fullContents = this.loadClusterContents(cluster);

    if (fullContents.length === 0) {
      throw new Error(`No content found for cluster ${cluster.cluster_id}`);
    }

    const prompt = this.buildRuleGenerationPrompt(cluster, fullContents);

    // Dynamic max_tokens based on complexity
    const maxTokens = this.calculateMaxTokens(cluster);

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-6-20250514",
        max_tokens: maxTokens,
        messages: [{
          role: "user",
          content: prompt
        }]
      });

      const responseText = response.content[0].type === "text" ? response.content[0].text : "";
      const parsed = this.parseRuleResponse(responseText);

      // Extract session IDs from labeled content
      const sessionIds = new Set(fullContents.map(c => c.session_id));

      const now = new Date().toISOString();

      return {
        id: ruleId,
        title: parsed.title,
        description: parsed.description,
        rationale: parsed.rationale,
        how_to_apply: parsed.how_to_apply,
        examples: parsed.examples,
        when_to_use: parsed.when_to_use,
        exceptions: parsed.exceptions,
        related_patterns: parsed.related_patterns,
        source_cluster_id: cluster.cluster_id,
        source_signals: cluster.common_signals,
        source_sessions: Array.from(sessionIds),
        evidence_count: cluster.total_occurrences,
        scenes: parsed.scenes,
        confidence: cluster.avg_confidence,
        priority: this.determinePriority(cluster),
        created_at: now,
        last_validated: now
      };
    } catch (error) {
      console.error("LLM rule generation failed:", error);
      throw error;
    }
  }

  /**
   * Batch generate rules from multiple clusters
   */
  async batchGenerateRules(
    clusters: PatternCluster[],
    startRuleId: number
  ): Promise<GeneratedRule[]> {
    const rules: GeneratedRule[] = [];

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const ruleId = `rule-${String(startRuleId + i).padStart(3, "0")}`;

      try {
        const rule = await this.generateRule(cluster, ruleId);
        rules.push(rule);
        console.error(`✓ Generated rule ${ruleId}: ${rule.title}`);
      } catch (error) {
        console.error(`✗ Failed to generate rule for cluster ${cluster.cluster_id}:`, error);
      }
    }

    return rules;
  }

  /**
   * Load labeled content for cluster
   */
  private loadClusterContents(cluster: PatternCluster): LabeledContent[] {
    const contents: LabeledContent[] = [];

    for (const contentId of cluster.labeled_content_ids) {
      // Load from database by ID
      // Since we don't have a direct getById method, we'll need to filter
      // This is a simplified version - in production, add getById method
      const allContent = this.db.getLabeledContentByPatternType(cluster.pattern_type);
      const content = allContent.find(c => c.id === contentId);

      if (content) {
        contents.push(content);
      }
    }

    return contents;
  }

  /**
   * Build prompt for rule generation (optimized for token efficiency)
   */
  private buildRuleGenerationPrompt(cluster: PatternCluster, contents: LabeledContent[]): string {
    // Intelligently select 3-5 most representative examples
    const selectedExamples = this.selectRepresentativeExamples(contents, 5);
    const contentExamples = selectedExamples
      .map((c, i) => `${i + 1}. ${c.content}`)
      .join('\n');

    return `Create coding rule from observed patterns.

Type: ${cluster.pattern_type} | Occurrences: ${cluster.total_occurrences} | Sessions: ${cluster.session_count}
Signals: ${cluster.common_signals.slice(0, 5).join(', ')} | Confidence: ${(cluster.avg_confidence * 100).toFixed(0)}%

Examples:
${contentExamples}

Output JSON with:
Output JSON with:
- title: imperative, 60-80 chars, start with verb
- description: what to do/avoid, 3-5 sentences, specific and clear
- rationale: why this matters, 2-4 sentences, concrete benefits/risks
- how_to_apply: 3-6 actionable steps (array of strings)
- examples: {bad?, good, explanation} - realistic code (10-20 lines), optional
- when_to_use: 3-5 specific conditions (array)
- exceptions: 2-4 edge cases where rule doesn't apply (array, optional)
- scenes: {tech: array, business: array, generic: boolean}
  * generic=true only if applies regardless of tech (naming, readability principles)
  * generic=false for tech-specific (React hooks, SQL, REST)

Format:
{"title":"Use X for Y","description":"For Z cases, use X instead of Y. X is better because...","rationale":"X provides A and B. Y causes C problem.","how_to_apply":["Check if condition","Review for pattern"],"examples":{"bad":"// old way","good":"// new way","explanation":"Why better"},"when_to_use":["Condition 1","Condition 2"],"exceptions":["Exception 1"],"scenes":{"tech":["react"],"business":[],"generic":false}}

Be specific, actionable, concise.`;
  }

  /**
   * Parse LLM response
   */
  private parseRuleResponse(response: string): {
    title: string;
    description: string;
    rationale: string;
    how_to_apply: string[];
    examples?: { bad?: string; good: string; explanation: string };
    when_to_use: string[];
    exceptions?: string[];
    related_patterns?: string[];
    scenes: { tech: string[]; business: string[]; generic: boolean };
  } {
    try {
      // Extract JSON from markdown code block if present
      let jsonStr = response.trim();
      const jsonMatch = jsonStr.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      if (!parsed.title || !parsed.description || !parsed.rationale) {
        throw new Error("Missing required fields in LLM response");
      }

      // Ensure scenes has correct structure
      if (!parsed.scenes) {
        parsed.scenes = { tech: [], business: [], generic: false };
      }

      // Ensure arrays exist
      if (!parsed.how_to_apply || !Array.isArray(parsed.how_to_apply)) {
        parsed.how_to_apply = [];
      }
      if (!parsed.when_to_use || !Array.isArray(parsed.when_to_use)) {
        parsed.when_to_use = [];
      }

      return {
        title: parsed.title,
        description: parsed.description,
        rationale: parsed.rationale,
        how_to_apply: parsed.how_to_apply,
        examples: parsed.examples,
        when_to_use: parsed.when_to_use,
        exceptions: parsed.exceptions,
        related_patterns: parsed.related_patterns,
        scenes: {
          tech: parsed.scenes.tech || [],
          business: parsed.scenes.business || [],
          generic: parsed.scenes.generic || false
        }
      };
    } catch (error) {
      console.error("Failed to parse rule response:", error);
      console.error("Response was:", response);
      throw new Error("Failed to parse LLM response");
    }
  }

  /**
   * Determine rule priority based on pattern type and confidence
   */
  private determinePriority(cluster: PatternCluster): "critical" | "high" | "medium" | "low" {
    // Security is always critical
    if (cluster.pattern_type === "security") {
      return "critical";
    }

    // Anti-patterns and performance are high priority
    if (cluster.pattern_type === "anti-pattern" || cluster.pattern_type === "performance") {
      return "high";
    }

    // Corrections with high confidence and multiple occurrences are medium
    if (cluster.pattern_type === "correction") {
      if (cluster.avg_confidence >= 0.8 && cluster.total_occurrences >= 3) {
        return "medium";
      }
    }

    // Everything else is low priority
    return "low";
  }

  /**
   * Convert generated rule to storage format
   */
  convertToStorageFormat(
    rule: GeneratedRule
  ): { indexEntry: RuleIndexEntry; content: RuleContent } {
    const indexEntry: RuleIndexEntry = {
      id: rule.id,
      type: (rule.priority === "critical" || rule.priority === "high" ? PatternType.ANTI_PATTERN : PatternType.REPEATED_CORRECTION),
      priority: rule.priority as Priority,
      confidence: rule.confidence,
      scenes: {
        tech: rule.scenes.tech,
        functional: rule.scenes.business,
        business: []
      },
      keywords: rule.source_signals,
      created_at: rule.created_at,
      updated_at: rule.last_validated
    };

    // Build structured content (Phase 4)
    let formattedContent = `# ${rule.title}\n\n`;
    formattedContent += `## Description\n\n${rule.description}\n\n`;
    formattedContent += `## Rationale\n\n${rule.rationale}\n\n`;

    // How to apply
    if (rule.how_to_apply && rule.how_to_apply.length > 0) {
      formattedContent += `## How to Apply\n\n`;
      for (const step of rule.how_to_apply) {
        formattedContent += `- ${step}\n`;
      }
      formattedContent += `\n`;
    }

    // Code examples
    if (rule.examples) {
      formattedContent += `## Examples\n\n`;
      if (rule.examples.bad) {
        formattedContent += `### ❌ Avoid\n\n\`\`\`typescript\n${rule.examples.bad}\n\`\`\`\n\n`;
      }
      formattedContent += `### ✅ Prefer\n\n\`\`\`typescript\n${rule.examples.good}\n\`\`\`\n\n`;
      formattedContent += `**Why**: ${rule.examples.explanation}\n\n`;
    }

    // When to use
    if (rule.when_to_use && rule.when_to_use.length > 0) {
      formattedContent += `## When to Use\n\n`;
      for (const condition of rule.when_to_use) {
        formattedContent += `- ${condition}\n`;
      }
      formattedContent += `\n`;
    }

    // Exceptions
    if (rule.exceptions && rule.exceptions.length > 0) {
      formattedContent += `## Exceptions\n\n`;
      for (const exception of rule.exceptions) {
        formattedContent += `- ${exception}\n`;
      }
      formattedContent += `\n`;
    }

    const content: RuleContent = {
      id: rule.id,
      content: formattedContent,

      // Structured fields (Phase 4)
      title: rule.title,
      description: rule.description,
      reason: rule.rationale,
      how_to_apply: rule.how_to_apply,
      examples: rule.examples ? [{
        bad: rule.examples.bad,
        good: rule.examples.good,
        explanation: rule.examples.explanation,
        language: "typescript"
      }] : undefined,
      when_to_use: rule.when_to_use,
      exceptions: rule.exceptions,
      related_rules: rule.related_patterns,

      metadata: {
        type: indexEntry.type,
        priority: rule.priority,
        confidence: rule.confidence,
        source: "adaptive_learning",
        pattern_occurrences: rule.evidence_count,
        first_seen: rule.created_at,
        last_seen: rule.last_validated,
        keywords: rule.source_signals,
        source_cluster_id: rule.source_cluster_id,
        source_sessions: rule.source_sessions
      }
    };

    return { indexEntry, content };
  }

  /**
   * Calculate dynamic max_tokens based on pattern complexity
   */
  private calculateMaxTokens(cluster: PatternCluster): number {
    // Security and anti-patterns need more detailed explanations
    if (cluster.pattern_type === "security") {
      return 1500;
    }

    // High confidence + many occurrences = important rule, give more tokens
    if (cluster.avg_confidence >= 0.8 && cluster.total_occurrences >= 5) {
      return 1200;
    }

    // Simple preferences with few occurrences = brief explanation sufficient
    if (cluster.pattern_type === "preference" && cluster.total_occurrences < 3) {
      return 700;
    }

    // Default: moderate complexity
    return 1000;
  }

  /**
   * Select representative examples using diversity sampling
   */
  private selectRepresentativeExamples(contents: LabeledContent[], maxCount: number): LabeledContent[] {
    if (contents.length <= maxCount) {
      return contents;
    }

    // Strategy: Select diverse examples by content length and keywords
    const selected: LabeledContent[] = [];
    const remaining = [...contents];

    // 1. Always include first example (usually most representative)
    selected.push(remaining.shift()!);

    // 2. Sort by length diversity (mix of short and long)
    remaining.sort((a, b) => {
      const avgLen = contents.reduce((sum, c) => sum + c.content.length, 0) / contents.length;
      const aDiff = Math.abs(a.content.length - avgLen);
      const bDiff = Math.abs(b.content.length - avgLen);
      return bDiff - aDiff;
    });

    // 3. Select remaining based on diversity
    while (selected.length < maxCount && remaining.length > 0) {
      selected.push(remaining.shift()!);
    }

    return selected;
  }

  /**
   * Validate rule quality
   */
  validateRuleQuality(rule: GeneratedRule): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check title
    if (rule.title.length < 10) {
      issues.push("Title too short (< 10 characters)");
    }
    if (rule.title.length > 100) {
      issues.push("Title too long (> 100 characters)");
    }
    if (!/^[A-Z]/.test(rule.title)) {
      issues.push("Title should start with capital letter");
    }

    // Check description
    if (rule.description.length < 50) {
      issues.push("Description too short (< 50 characters)");
    }
    if (rule.description.length > 500) {
      issues.push("Description too long (> 500 characters)");
    }

    // Check rationale
    if (rule.rationale.length < 20) {
      issues.push("Rationale too short (< 20 characters)");
    }

    // Check scenes
    if (rule.scenes.tech.length === 0 && !rule.scenes.generic) {
      issues.push("Rule must have either tech tags or be marked as generic");
    }

    // Check confidence
    if (rule.confidence < 0.5) {
      issues.push("Confidence too low (< 0.5)");
    }

    return {
      isValid: issues.length === 0,
      issues
    };
  }

  close() {
    this.db.close();
  }
}
