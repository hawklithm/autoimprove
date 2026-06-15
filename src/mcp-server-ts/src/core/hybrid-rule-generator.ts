/**
 * Hybrid Rule Generator - Multi-phase rule generation strategy
 *
 * Phase 1: Basic pattern detection (SessionAnalyzer)
 * Phase 2: LLM content enhancement with full context
 * Phase 3: Code example extraction from session tool calls
 * Phase 4: Structured storage with rich metadata
 */

import { Pattern, RuleIndexEntry, RuleContent, Scene, CodeExample } from "./models.js";
import { RuleGenerator } from "./rule-generator.js";
import { CodeExampleExtractor } from "./code-example-extractor.js";
import Anthropic from "@anthropic-ai/sdk";

export interface EnhancedRuleOptions {
  /** Whether to use LLM for content enhancement (Phase 2) */
  useLLMEnhancement?: boolean;

  /** Whether to extract code examples from sessions (Phase 3) */
  extractCodeExamples?: boolean;

  /** Path to session files directory */
  sessionDir?: string;

  /** Maximum number of examples to include */
  maxExamples?: number;
}

export class HybridRuleGenerator {
  private basicGenerator: RuleGenerator;
  private exampleExtractor: CodeExampleExtractor;
  private anthropic: Anthropic | null;

  constructor() {
    this.basicGenerator = new RuleGenerator();
    this.exampleExtractor = new CodeExampleExtractor();

    // Initialize Anthropic client if API key available
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      this.anthropic = null;
    }
  }

  /**
   * Generate enhanced rule from pattern (all phases)
   */
  async generateEnhancedRule(
    pattern: Pattern,
    ruleId: string,
    scene?: Scene,
    options: EnhancedRuleOptions = {}
  ): Promise<{ indexEntry: RuleIndexEntry; content: RuleContent }> {
    const {
      useLLMEnhancement = false,
      extractCodeExamples = true,
      sessionDir = "~/.claude/sessions",
      maxExamples = 3
    } = options;

    // Phase 1: Generate basic rule
    const basicRule = this.basicGenerator.generateRule(pattern, ruleId, scene);

    // Phase 2: LLM enhancement (if enabled and available)
    let enhancedContent: RuleContent;
    if (useLLMEnhancement && this.anthropic) {
      try {
        enhancedContent = await this.enhanceWithLLM(pattern, basicRule.content, ruleId);
      } catch (error) {
        console.error(`LLM enhancement failed for ${ruleId}, using basic content:`, error);
        enhancedContent = basicRule.content;
      }
    } else {
      enhancedContent = basicRule.content;
    }

    // Phase 3: Extract code examples (if enabled)
    if (extractCodeExamples && sessionDir) {
      try {
        const examples = this.exampleExtractor.extractExamples(pattern, sessionDir);
        if (examples.length > 0) {
          enhancedContent.examples = examples.slice(0, maxExamples);

          // Update formatted content with examples
          enhancedContent.content = this.addExamplesToContent(
            enhancedContent.content,
            examples.slice(0, maxExamples)
          );
        }
      } catch (error) {
        console.error(`Code example extraction failed for ${ruleId}:`, error);
      }
    }

    // Phase 4: Return structured rule with rich metadata
    return {
      indexEntry: basicRule.indexEntry,
      content: enhancedContent
    };
  }

  /**
   * Batch generate enhanced rules
   */
  async batchGenerateEnhancedRules(
    patterns: Pattern[],
    startId: number,
    scene?: Scene,
    options: EnhancedRuleOptions = {}
  ): Promise<Array<{ indexEntry: RuleIndexEntry; content: RuleContent }>> {
    const rules: Array<{ indexEntry: RuleIndexEntry; content: RuleContent }> = [];

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const ruleId = `rule-${String(startId + i).padStart(3, "0")}`;

      // Check if should generate rule
      const { shouldGenerate } = this.basicGenerator["classifier"].shouldGenerateRule(pattern);
      if (!shouldGenerate) {
        continue;
      }

      const rule = await this.generateEnhancedRule(pattern, ruleId, scene, options);
      rules.push(rule);

      console.error(`✓ Generated enhanced rule ${ruleId}: ${rule.content.title || pattern.description}`);
    }

    return rules;
  }

  /**
   * Phase 2: Enhance rule content with LLM
   */
  private async enhanceWithLLM(
    pattern: Pattern,
    basicContent: RuleContent,
    ruleId: string
  ): Promise<RuleContent> {
    if (!this.anthropic) {
      throw new Error("Anthropic API key not available");
    }

    // Build enhancement prompt with full pattern context
    const prompt = this.buildEnhancementPrompt(pattern, basicContent);

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: prompt
      }]
    });

    const responseText = response.content[0].type === "text" ? response.content[0].text : "";
    const enhanced = this.parseEnhancedResponse(responseText);

    // Build formatted content
    let formattedContent = `# ${enhanced.title}\n\n`;
    formattedContent += `## Description\n\n${enhanced.description}\n\n`;
    formattedContent += `## Rationale\n\n${enhanced.rationale}\n\n`;

    if (enhanced.how_to_apply && enhanced.how_to_apply.length > 0) {
      formattedContent += `## How to Apply\n\n`;
      for (const step of enhanced.how_to_apply) {
        formattedContent += `- ${step}\n`;
      }
      formattedContent += `\n`;
    }

    if (enhanced.when_to_use && enhanced.when_to_use.length > 0) {
      formattedContent += `## When to Use\n\n`;
      for (const condition of enhanced.when_to_use) {
        formattedContent += `- ${condition}\n`;
      }
      formattedContent += `\n`;
    }

    if (enhanced.exceptions && enhanced.exceptions.length > 0) {
      formattedContent += `## Exceptions\n\n`;
      for (const exception of enhanced.exceptions) {
        formattedContent += `- ${exception}\n`;
      }
      formattedContent += `\n`;
    }

    return {
      ...basicContent,
      content: formattedContent,
      title: enhanced.title,
      description: enhanced.description,
      reason: enhanced.rationale,
      how_to_apply: enhanced.how_to_apply,
      when_to_use: enhanced.when_to_use,
      exceptions: enhanced.exceptions,
      related_rules: enhanced.related_patterns
    };
  }

  /**
   * Build enhancement prompt
   */
  private buildEnhancementPrompt(pattern: Pattern, basicContent: RuleContent): string {
    // Collect user input from occurrences
    const userInputs = pattern.occurrences
      .filter(o => o.user_input)
      .map((o, i) => `${i + 1}. ${o.user_input}`)
      .join('\n');

    return `You are enhancing a coding rule that was automatically detected from user corrections.

**Basic Rule**:
${basicContent.content}

**Pattern Type**: ${pattern.type}
**Confidence**: ${(pattern.confidence * 100).toFixed(1)}%
**Occurrences**: ${pattern.occurrences.length}

**User Corrections/Feedback** (actual messages from sessions):
${userInputs || "No direct user input captured"}

**Context Information**:
- First seen: ${pattern.first_seen}
- Last seen: ${pattern.last_seen}
- Keywords: ${pattern.keywords.join(', ')}

Please enhance this rule to be more comprehensive and actionable. Generate:

1. **Title**: Improved title in imperative form (60-80 chars)
   - Clear, specific, actionable
   - Start with a verb

2. **Description**: Expanded description (4-6 sentences)
   - What to do or what to avoid
   - Concrete guidance with context
   - What to look for in code reviews
   - Include specific patterns or indicators

3. **Rationale**: Detailed explanation (3-5 sentences)
   - What specific problems does this prevent?
   - What concrete benefits does following this provide?
   - Performance, security, maintainability, or readability impact
   - Why is this important in practice?

4. **How to Apply**: Practical steps (4-6 bullet points)
   - Concrete actions developers should take
   - What to check during code reviews
   - Refactoring steps if fixing existing code
   - Tools or lint rules that can help

5. **When to Use**: Specific conditions (3-5 bullet points)
   - Clear scenarios where this rule applies
   - Concrete indicators that trigger this rule
   - Context-specific conditions

6. **Exceptions**: When NOT to apply (2-4 bullet points, optional)
   - Legitimate exceptions or edge cases
   - Situations where breaking this rule is acceptable
   - Alternative approaches for those cases

Respond in JSON format:
{
  "title": "...",
  "description": "...",
  "rationale": "...",
  "how_to_apply": ["step 1", "step 2", ...],
  "when_to_use": ["condition 1", "condition 2", ...],
  "exceptions": ["exception 1", ...],
  "related_patterns": ["pattern 1", ...]
}

IMPORTANT:
- Be specific and actionable
- Use insights from the user corrections
- Provide practical guidance developers can follow
- Explain the "why" behind recommendations
- Keep technical accuracy high`;
  }

  /**
   * Parse enhanced response from LLM
   */
  private parseEnhancedResponse(response: string): {
    title: string;
    description: string;
    rationale: string;
    how_to_apply: string[];
    when_to_use: string[];
    exceptions?: string[];
    related_patterns?: string[];
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
        throw new Error("Missing required fields in enhanced response");
      }

      return {
        title: parsed.title,
        description: parsed.description,
        rationale: parsed.rationale,
        how_to_apply: parsed.how_to_apply || [],
        when_to_use: parsed.when_to_use || [],
        exceptions: parsed.exceptions,
        related_patterns: parsed.related_patterns
      };
    } catch (error) {
      console.error("Failed to parse enhanced response:", error);
      console.error("Response was:", response);
      throw error;
    }
  }

  /**
   * Add code examples to formatted content
   */
  private addExamplesToContent(content: string, examples: CodeExample[]): string {
    let updated = content;

    // Find position to insert (before "When to Use" or at end)
    const insertMarkers = ["## When to Use", "## Exceptions", "## Related"];
    let insertPos = -1;

    for (const marker of insertMarkers) {
      insertPos = updated.indexOf(marker);
      if (insertPos !== -1) break;
    }

    const examplesSection = this.formatExamplesSection(examples);

    if (insertPos !== -1) {
      updated = updated.slice(0, insertPos) + examplesSection + "\n" + updated.slice(insertPos);
    } else {
      updated += "\n" + examplesSection;
    }

    return updated;
  }

  /**
   * Format examples section
   */
  private formatExamplesSection(examples: CodeExample[]): string {
    let section = `## Examples\n\n`;

    for (let i = 0; i < examples.length; i++) {
      const example = examples[i];
      const lang = example.language || "typescript";

      if (i > 0) {
        section += `\n### Example ${i + 1}\n\n`;
      }

      if (example.bad) {
        section += `### ❌ Avoid\n\n\`\`\`${lang}\n${example.bad}\n\`\`\`\n\n`;
      }

      section += `### ✅ Prefer\n\n\`\`\`${lang}\n${example.good}\n\`\`\`\n\n`;
      section += `**Why**: ${example.explanation}\n\n`;
    }

    return section;
  }
}
