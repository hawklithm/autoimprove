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

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-6-20250514",
        max_tokens: 1500,
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
   * Build prompt for rule generation
   */
  private buildRuleGenerationPrompt(cluster: PatternCluster, contents: LabeledContent[]): string {
    const contentExamples = contents
      .slice(0, 10) // Limit to first 10 examples
      .map((c, i) => `${i + 1}. ${c.content}`)
      .join('\n');

    return `You are creating a coding rule from observed correction/preference patterns.

Pattern Type: ${cluster.pattern_type}
Total Occurrences: ${cluster.total_occurrences}
Sessions: ${cluster.session_count}
Common Signal Words: ${cluster.common_signals.join(', ')}
Average Confidence: ${(cluster.avg_confidence * 100).toFixed(1)}%

Example corrections/preferences from user messages:
${contentExamples}

Generate a clear, actionable coding rule with:

1. **Title**: Short, actionable title in imperative form (e.g., "Use useState for simple state management")
   - Start with a verb
   - Be specific and concrete
   - Keep under 80 characters

2. **Description**: What to do OR what to avoid (2-3 sentences)
   - Be clear and specific
   - Include concrete examples when possible
   - Explain the correct approach

3. **Rationale**: Why this rule exists (1-2 sentences)
   - What benefits does following this provide?
   - What problems does it prevent?
   - Why is this important?

4. **Scene Tags**: Categorize where this rule applies
   - **tech**: List specific technologies (e.g., ["react", "typescript", "hooks"])
   - **business**: List business domains if applicable (e.g., ["e-commerce", "authentication"])
   - **generic**: Is this a universal principle? (true/false)
     - Set to true only if it applies regardless of tech stack
     - Examples of generic: code readability, naming conventions, error handling principles
     - Examples of NOT generic: React hooks, SQL queries, REST API design

Respond in JSON format:
{
  "title": "Use useState for simple state management",
  "description": "For boolean or simple value state, use useState instead of useReducer. Reserve useReducer for complex state with multiple sub-values or complex state transitions. Simple state updates like toggling a boolean or incrementing a counter should use useState.",
  "rationale": "useState is simpler and more readable for basic cases. Using useReducer adds unnecessary complexity and boilerplate for simple state, making the code harder to understand and maintain.",
  "scenes": {
    "tech": ["react", "hooks"],
    "business": [],
    "generic": false
  }
}

IMPORTANT:
- Title must be imperative form (command)
- Description must be actionable and specific
- Rationale must explain the "why"
- Be precise with scene tags - don't over-generalize`;
  }

  /**
   * Parse LLM response
   */
  private parseRuleResponse(response: string): {
    title: string;
    description: string;
    rationale: string;
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

      return {
        title: parsed.title,
        description: parsed.description,
        rationale: parsed.rationale,
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

    const content: RuleContent = {
      id: rule.id,
      content: `# ${rule.title}\n\n${rule.description}`,
      reason: rule.rationale,
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
