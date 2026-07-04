/**
 * LLM Prompt Builder - Unified prompt construction for rule generation
 *
 * Provides a consistent prompt structure while supporting different input sources:
 * - Pattern-based: Uses Pattern objects with metadata
 * - Content-based: Uses LabeledContent with full conversation context
 */

import { Pattern, PatternType } from "./models.js";
import { LabeledContent } from "../storage/signal-dictionary-db.js";

/**
 * Evidence source for prompt construction
 */
export interface PromptEvidence {
  /** Brief description of the pattern/correction */
  description: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Number of occurrences */
  occurrences: number;
  /** Keywords related to this evidence */
  keywords: string[];
  /** Full content examples (optional, for detailed analysis) */
  contentExamples?: string[];
  /** User input context (optional) */
  userContext?: string[];
}

/**
 * Prompt configuration options
 */
export interface PromptOptions {
  /** Pattern type being analyzed */
  patternType: PatternType;
  /** Average confidence across all evidence */
  avgConfidence: number;
  /** Common keywords across evidence */
  commonKeywords: string[];
  /** Total number of occurrences */
  totalOccurrences: number;
  /** Number of sessions this pattern appeared in */
  sessionCount?: number;
  /** Whether this is for merging multiple patterns */
  isBatchMode: boolean;
  /** Maximum number of content examples to include (token optimization) */
  maxContentExamples?: number;
}

/**
 * Unified LLM Prompt Builder
 */
export class LLMPromptBuilder {
  /**
   * Build rule generation prompt from evidence
   */
  static buildPrompt(evidence: PromptEvidence[], options: PromptOptions): string {
    const {
      patternType,
      avgConfidence,
      commonKeywords,
      totalOccurrences,
      sessionCount,
      isBatchMode,
      maxContentExamples = 5
    } = options;

    const isSinglePattern = evidence.length === 1;

    // Build evidence section
    const evidenceSection = this.buildEvidenceSection(evidence, maxContentExamples);

    // Build header with context
    const header = isBatchMode && !isSinglePattern
      ? this.buildBatchHeader()
      : this.buildSingleHeader();

    // Build metadata section
    const metadataSection = this.buildMetadataSection({
      patternType,
      avgConfidence,
      commonKeywords,
      totalOccurrences,
      sessionCount
    });

    // Build instructions section
    const instructionsSection = isBatchMode && !isSinglePattern
      ? this.buildBatchInstructions()
      : this.buildSingleInstructions();

    // Build output format section
    const outputFormatSection = this.buildOutputFormat(isBatchMode && !isSinglePattern);

    // Build quality standards section
    const qualitySection = this.buildQualityStandards();

    return `${header}

${metadataSection}

${evidenceSection}

${instructionsSection}

${outputFormatSection}

${qualitySection}`;
  }

  /**
   * Build evidence section from various sources
   */
  private static buildEvidenceSection(
    evidence: PromptEvidence[],
    maxContentExamples: number
  ): string {
    const hasDetailedContent = evidence.some(e => e.contentExamples && e.contentExamples.length > 0);

    let section = `Patterns (${evidence.length}):\n`;

    if (hasDetailedContent) {
      // Content-based mode: include full conversation context
      section += this.buildDetailedContentSection(evidence, maxContentExamples);
    } else {
      // Pattern-based mode: use descriptions and user context
      section += this.buildPatternDescriptionSection(evidence);
    }

    return section;
  }

  /**
   * Build detailed content section (for content-based mode)
   */
  private static buildDetailedContentSection(
    evidence: PromptEvidence[],
    maxContentExamples: number
  ): string {
    // Select representative examples using diversity sampling
    const selectedEvidence = this.selectRepresentativeEvidence(evidence, maxContentExamples);

    return selectedEvidence
      .map((e, i) => {
        let entry = `${i + 1}. Pattern: "${e.description}"\n`;
        entry += `   Confidence: ${(e.confidence * 100).toFixed(0)}%, Occurrences: ${e.occurrences}`;

        if (e.keywords.length > 0) {
          entry += `, Keywords: ${e.keywords.slice(0, 5).join(", ")}`;
        }
        entry += '\n';

        // Add content examples
        if (e.contentExamples && e.contentExamples.length > 0) {
          entry += `   Evidence (user corrections):\n`;
          e.contentExamples.forEach((content, idx) => {
            entry += `     ${String.fromCharCode(97 + idx)}. ${content}\n`;
          });
        }

        return entry;
      })
      .join('\n');
  }

  /**
   * Build pattern description section (for pattern-based mode)
   */
  private static buildPatternDescriptionSection(evidence: PromptEvidence[]): string {
    return evidence
      .map((e, i) => {
        let entry = `${i + 1}. "${e.description}"\n`;
        entry += `   Confidence: ${(e.confidence * 100).toFixed(0)}%, Occurrences: ${e.occurrences}`;

        if (e.keywords.length > 0) {
          entry += `, Keywords: ${e.keywords.slice(0, 5).join(", ")}`;
        }
        entry += '\n';

        // Add user context if available
        if (e.userContext && e.userContext.length > 0) {
          entry += `   Evidence: ${e.userContext.join(" | ")}`;
        }

        return entry;
      })
      .join('\n\n');
  }

  /**
   * Build metadata section
   */
  private static buildMetadataSection(meta: {
    patternType: PatternType;
    avgConfidence: number;
    commonKeywords: string[];
    totalOccurrences: number;
    sessionCount?: number;
  }): string {
    let section = `Type: ${meta.patternType} | Avg confidence: ${(meta.avgConfidence * 100).toFixed(0)}%\n`;
    section += `Common keywords: ${meta.commonKeywords.join(", ")}\n`;

    if (meta.sessionCount !== undefined) {
      section += `Evidence: ${meta.totalOccurrences} occurrences across ${meta.sessionCount} sessions`;
    }

    return section;
  }

  /**
   * Build header for batch mode with project context
   */
  private static buildBatchHeader(): string {
    return `# AutoImprove: Extract Reusable Coding Rules from User Corrections

You are analyzing patterns from Claude Code sessions where users corrected Claude's mistakes. Your goal is to synthesize these corrections into **actionable coding rules** that prevent Claude from repeating the same errors in future sessions.

## Context: What is AutoImprove?

AutoImprove is a learning system that:
- Monitors Claude Code sessions for user corrections (edits, fixes, feedback)
- Detects recurring mistake patterns across multiple sessions
- Generates reusable rules that Claude loads at session start
- Helps Claude improve over time by learning from real user feedback

## Your Task: Analyze and Merge Patterns

You will receive multiple correction patterns from different sessions. Your job is to:

1. **Identify similarities**: Which patterns describe the SAME underlying mistake?
2. **Merge duplicates**: Combine similar patterns into ONE comprehensive rule
3. **Separate distinct issues**: Keep unrelated patterns as SEPARATE rules
4. **Extract actionable guidance**: Create rules Claude can apply BEFORE making the mistake

## What Makes a Good Rule?

**Not this** (too vague): "Handle errors properly"
**But this** (specific + actionable): "Use try-catch with specific error types instead of generic catch-all blocks. Log error context (user ID, timestamp, operation) for debugging. Return user-friendly messages, never expose stack traces."

A good rule:
- **Captures root cause**: Why did the mistake happen? What principle was violated?
- **Generalizes appropriately**: Abstract from specific examples, but stay grounded in evidence
- **Prevents future errors**: Checkable conditions Claude can verify BEFORE writing code
- **Balances specificity**: Not too narrow (only works for exact case) or too broad (unhelpful)`;
  }

  /**
   * Build header for single pattern mode
   */
  private static buildSingleHeader(): string {
    return `# AutoImprove: Extract Reusable Coding Rule from Pattern

You are analyzing a pattern from Claude Code sessions where users corrected Claude's code. Your goal is to synthesize this correction into an **actionable coding rule** that prevents Claude from repeating the same error.

## Context: What is AutoImprove?

AutoImprove is a learning system that monitors Claude Code sessions, detects recurring mistakes, and generates reusable rules that Claude loads at session start to improve over time.

## Your Task: Generate One Rule

Extract a clear, actionable rule from the correction pattern below. The rule should:
- Capture the root cause of the mistake
- Be specific enough to prevent the error
- Be general enough to apply beyond the exact example
- Include concrete steps Claude can check before coding`;
  }

  /**
   * Build instructions for batch mode (merging multiple patterns)
   */
  private static buildBatchInstructions(): string {
    return `## Analysis Steps

1. **Group by similarity**: Read all patterns and identify which ones describe the SAME mistake
   - Same root cause? → MERGE into one rule
   - Different root causes? → Keep as SEPARATE rules

2. **Extract the pattern**: For each group, identify:
   - What mistake is repeating?
   - Why did Claude get it wrong? (missing knowledge, wrong assumption, oversight)
   - What's the underlying principle being violated?

3. **Generalize carefully**:
   - Find the common thread across examples
   - Abstract to a broader principle, but stay evidence-based
   - Don't over-generalize beyond what the data supports

4. **Make it actionable**:
   - Write steps Claude can CHECK before writing code
   - Use concrete conditions, not vague advice
   - Include both positive guidance (do this) and warnings (avoid that)

5. **Document thoroughly**:
   - **title**: Clear imperative statement (60-80 chars)
   - **description**: What to do/avoid (3-5 sentences, specific)
   - **rationale**: WHY this matters - what breaks if violated (bugs, performance, security)
   - **how_to_apply**: Concrete steps to follow (3-6 actionable checks)
   - **when_to_use**: Specific triggers/scenarios (3-5 conditions)
   - **exceptions**: Real edge cases where rule doesn't apply (2-4 cases)
   - **source_patterns**: List original patterns merged (for traceability)
   - **merged_count**: Number of patterns combined`;
  }

  /**
   * Build instructions for single pattern mode
   */
  private static buildSingleInstructions(): string {
    return `## Analysis Steps

1. **Identify the mistake**: What specific error did Claude make?
2. **Find the root cause**: Why did it happen? What was missing or wrong?
3. **Extract the principle**: What genuld have prevented this?
4. **Make it actionable**: How can Claude check this BEFORE coding?
5. **Generalize appropriately**: Broader than the example, but evidence-based

Generate 1 rule following the output format below.`;
  }

  /**
   * Build output format section
   */
  private static buildOutputFormat(isBatchMode: boolean): string {
    const outputType = isBatchMode ? 'JSON array' : 'JSON object';

    let section = `Output ${outputType}: `;

    if (isBatchMode) {
      section += `[{"title":"...","description":"...","rationale":"...","how_to_apply":[...],"when_to_use":[...],"exceptions":[...],"source_patterns":["pattern 1","pattern 2"],"merged_count":2}]\n\n`;
      section += `If all patterns are similar, return 1 rule. If distinct, return multiple rules.\n\n`;
    } else {
      section += `{"title":"...","description":"...","rationale":"...","how_to_apply":[...],"when_to_use":[...],"exceptions":[]}\n\n`;
    }

    section += `Rules:
- title: imperative verb, 60-80 chars
- description: what to do/avoid, 3-5 sentences, specific
- rationale: why (2-4 sentences, concrete benefits/risks)
- how_to_apply: 3-6 actionable steps (array)
- when_to_use: 3-5 conditions (array)
- exceptions: 2-4 edge cases (array, optional)`;

    if (isBatchMode) {
      section += `\n- source_patterns: original pattern descriptions merged (array)
- merged_count: number of patterns merged into this rule`;
    }

    section += `\n\nCRITICAL: Do NOT include "examples" field. Focus on clear descriptions and actionable steps.`;

    return section;
  }

  /**
   * Build quality standards section
   */
  private static buildQualityStandards(): string {
    return `Be specific, actionable, deduplicate aggressively.

Quality checklist:
- Title: Imperative verb phrase (e.g., "Use X instead of Y for Z", "Avoid X when Y")
- Description: Specific enough to be falsifiable. Concrete over abstract.
- Rationale: Answer "so what?" - what goes wrong if ignored? (bugs, security, performance)
- How to apply: Each step should be a concrete check, not vague advice
- When to use: Specific triggers, not generic conditions
- Exceptions: Real edge cases, not hypothetical scenarios`;
  }

  /**
   * Select representative evidence using diversity sampling (TF-IDF-like approach)
   */
  private static selectRepresentativeEvidence(
    evidence: PromptEvidence[],
    maxCount: number
  ): PromptEvidence[] {
    if (evidence.length <= maxCount) {
      return evidence;
    }

    // Sort by confidence * occurrences (importance score)
    const scored = evidence.map(e => ({
      evidence: e,
      score: e.confidence * Math.log(1 + e.occurrences)
    }));

    scored.sort((a, b) => b.score - a.score);

    // Take top N by importance
    return scored.slice(0, maxCount).map(s => s.evidence);
  }

  /**
   * Convert Pattern to PromptEvidence (for pattern-based generation)
   */
  static patternToEvidence(pattern: Pattern): PromptEvidence {
    const userContext = pattern.occurrences
      .map(o => o.user_input)
      .filter((input): input is string => input !== undefined && input.length > 20)
      .slice(0, 2);

    return {
      description: pattern.description,
      confidence: pattern.confidence,
      occurrences: pattern.occurrences.length,
      keywords: pattern.keywords,
      userContext: userContext.length > 0 ? userContext : undefined
    };
  }

  /**
   * Convert LabeledContent to PromptEvidence (for content-based generation)
   */
  static contentToEvidence(
    contents: LabeledContent[],
    description: string,
    avgConfidence: number,
    keywords: string[]
  ): PromptEvidence {
    // Extract unique content examples
    const contentExamples = contents
      .map(c => c.content)
      .filter((content, idx, arr) => arr.indexOf(content) === idx)  // Deduplicate
      .slice(0, 5);  // Limit to 5 examples

    return {
      description,
      confidence: avgConfidence,
      occurrences: contents.length,
      keywords,
      contentExamples
    };
  }

  /**
   * Get human-readable pattern type description
   */
  static getPatternTypeDescription(type: PatternType): string {
    const descriptions: Record<string, string> = {
      "repeated-correction": "user corrected same mistake multiple times",
      "anti-pattern": "approach that failed and required significant rework",
      "preference": "explicit user statement about how things should be done",
      "performance": "optimization or efficiency-related correction",
      "security": "security vulnerability or unsafe pattern"
    };
    return descriptions[type] || type;
  }
}
