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
   * Build prompt for rule generation
   */
  private buildRuleGenerationPrompt(cluster: PatternCluster, contents: LabeledContent[]): string {
    const contentExamples = contents
      .slice(0, 10) // Limit to first 10 examples
      .map((c, i) => `${i + 1}. ${c.content}`)
      .join('\n');

    return `You are creating a comprehensive coding rule from observed correction/preference patterns.

Pattern Type: ${cluster.pattern_type}
Total Occurrences: ${cluster.total_occurrences}
Sessions: ${cluster.session_count}
Common Signal Words: ${cluster.common_signals.join(', ')}
Average Confidence: ${(cluster.avg_confidence * 100).toFixed(1)}%

Example corrections/preferences from user messages:
${contentExamples}

Generate a comprehensive, actionable coding rule with the following structure:

1. **Title**: Short, actionable title in imperative form (60-80 chars)
   - Start with a verb (e.g., "Use", "Avoid", "Prefer", "Always", "Never")
   - Be specific and concrete
   - Examples: "Use useState for simple state management", "Avoid nested ternary operators"

2. **Description**: What to do OR what to avoid (3-5 sentences)
   - Be clear and specific about the recommended practice
   - Explain the correct approach with context
   - Include what to look for in code reviews
   - Mention concrete patterns or indicators

3. **Rationale**: Why this rule exists (2-4 sentences)
   - What specific problems does it prevent?
   - What concrete benefits does following this provide?
   - What are the consequences of not following it?
   - Include performance, security, maintainability, or readability impact

4. **How to Apply**: Step-by-step guidance (3-6 bullet points)
   - Concrete actions developers should take
   - What to check during code reviews
   - Specific refactoring steps if fixing existing code
   - Tools or lint rules that can help enforce this
   - Examples:
     * "When you see a boolean state variable, use useState instead of useReducer"
     * "Run ESLint with the no-nested-ternary rule"
     * "During code review, flag any useReducer with only 2-3 simple actions"

5. **Code Examples**: Provide before/after comparison (if applicable to pattern type)
   - **bad**: Code showing the anti-pattern or incorrect approach (optional)
   - **good**: Code showing the correct approach
   - **explanation**: Brief explanation of why the good example is better (1-2 sentences)
   - Use realistic code snippets (10-20 lines)
   - Use the actual tech stack from the pattern
   - Include comments to highlight key differences

6. **When to Use**: Specific scenarios where this rule applies (3-5 bullet points)
   - Clear conditions or contexts when this rule is relevant
   - Concrete indicators that trigger this rule
   - Examples:
     * "State is a single primitive value (boolean, string, number)"
     * "State updates don't depend on previous state in complex ways"
     * "Component has fewer than 3 state variables"

7. **Exceptions**: Notable cases where this rule should NOT be applied (2-4 bullet points, optional)
   - Legitimate exceptions or edge cases
   - Situations where breaking this rule is acceptable
   - Alternative approaches for those cases
   - Examples:
     * "When state transitions need to be logged or tracked"
     * "When building a state machine with many states"
     * "When the pattern is required by a third-party library"

8. **Scene Tags**: Categorize where this rule applies
   - **tech**: List specific technologies (e.g., ["react", "typescript", "hooks"])
   - **business**: List business domains if applicable (e.g., ["e-commerce", "authentication"])
   - **generic**: Is this a universal principle? (true/false)
     - Set to true only if it applies regardless of tech stack
     - Examples of generic: code readability, naming conventions, error handling principles
     - Examples of NOT generic: React hooks, SQL queries, REST API design

Respond in JSON format:
{
  "title": "Use useState for simple state management",
  "description": "For boolean or simple primitive value state, use useState instead of useReducer. Reserve useReducer for complex state objects with multiple sub-values or complex state transitions. Simple state updates like toggling a boolean, incrementing a counter, or storing a string should use useState for clarity and simplicity.",
  "rationale": "useState is more readable and requires less boilerplate for simple cases. Using useReducer for basic state adds unnecessary complexity with action types, reducer functions, and dispatch calls, making the code harder to understand and maintain. The overhead of useReducer only pays off when managing complex state logic.",
  "how_to_apply": [
    "When creating new state, ask: Is this a single primitive value? If yes, use useState",
    "During code review, flag useReducer usage where the reducer only has 2-3 simple toggle/set actions",
    "Refactor existing useReducer to useState: replace dispatch calls with direct setState calls",
    "Use ESLint plugin 'eslint-plugin-react-hooks' to enforce best practices"
  ],
  "examples": {
    "bad": "const [isOpen, dispatch] = useReducer((state, action) => {\n  switch (action.type) {\n    case 'toggle': return !state;\n    default: return state;\n  }\n}, false);\n\n// Usage\ndispatch({ type: 'toggle' });",
    "good": "const [isOpen, setIsOpen] = useState(false);\n\n// Usage\nsetIsOpen(!isOpen);\n// or\nsetIsOpen(prev => !prev);",
    "explanation": "The useState version is more direct and readable. For a simple boolean toggle, the useReducer version adds unnecessary abstraction with action types and reducer logic."
  },
  "when_to_use": [
    "State is a single primitive value (boolean, string, number)",
    "State updates are simple assignments or toggles",
    "State transitions don't require validation or side effects",
    "Component has fewer than 5 independent state variables"
  ],
  "exceptions": [
    "When state transitions need to be logged or audited",
    "When building a finite state machine with specific valid transitions",
    "When multiple related state changes must happen atomically",
    "When the pattern is required by a library (e.g., form state management)"
  ],
  "scenes": {
    "tech": ["react", "hooks"],
    "business": [],
    "generic": false
  }
}

IMPORTANT:
- Title must be imperative form (command)
- Description must be actionable and specific (3-5 sentences minimum)
- Rationale must explain the "why" with concrete benefits/risks
- how_to_apply must have 3-6 practical steps
- examples should show realistic code (prefer including both bad and good)
- when_to_use should have 3-5 specific conditions
- exceptions are optional but valuable when applicable
- Be precise with scene tags - don't over-generalize`;
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
