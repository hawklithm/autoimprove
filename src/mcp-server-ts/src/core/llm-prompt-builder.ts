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

    // Build structured JSON context
    const jsonContext = this.buildStructuredContext(evidence, options, maxContentExamples);

    // Build header with context
    const header = isBatchMode && !isSinglePattern
      ? this.buildBatchHeader()
      : this.buildSingleHeader();

    // Build instructions section
    const instructionsSection = isBatchMode && !isSinglePattern
      ? this.buildBatchInstructions()
      : this.buildSingleInstructions();

    // Build output format section
    const outputFormatSection = this.buildOutputFormat(isBatchMode && !isSinglePattern);

    // Build quality standards section
    const qualitySection = this.buildQualityStandards();

    return `${header}

## Pattern Data (Structured JSON)

The following JSON contains all pattern information for analysis:

\`\`\`json
${jsonContext}
\`\`\`

${instructionsSection}

${outputFormatSection}

${qualitySection}`;
  }

  /**
   * Build structured JSON context from evidence
   */
  private static buildStructuredContext(
    evidence: PromptEvidence[],
    options: PromptOptions,
    maxContentExamples: number
  ): string {
    // Select representative examples using diversity sampling
    const selectedEvidence = evidence.length > maxContentExamples
      ? this.selectRepresentativeEvidence(evidence, maxContentExamples)
      : evidence;

    const context = {
      metadata: {
        pattern_type: options.patternType,
        total_patterns: evidence.length,
        selected_patterns: selectedEvidence.length,
        avg_confidence: Math.round(options.avgConfidence * 100) / 100,
        total_occurrences: options.totalOccurrences,
        session_count: options.sessionCount || 1,
        common_keywords: options.commonKeywords,
      },
      patterns: selectedEvidence.map((e, idx) => {
        const pattern: any = {
          id: idx + 1,
          description: e.description,
          confidence: Math.round(e.confidence * 100) / 100,
          occurrences: e.occurrences,
          keywords: e.keywords.slice(0, 5),
        };

        // Add content examples if available
        if (e.contentExamples && e.contentExamples.length > 0) {
          pattern.evidence = {
            type: "user_corrections",
            examples: e.contentExamples.map((content, contentIdx) => ({
              id: contentIdx + 1,
              content: content,
            })),
          };
        }

        // Add user context if available
        if (e.userContext && e.userContext.length > 0) {
          pattern.user_context = e.userContext;
        }

        return pattern;
      }),
    };

    return JSON.stringify(context, null, 2);
  }

  /**
   * Build evidence section from various sources (deprecated, kept for backward compatibility)
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
    return `## How to Read the JSON Data

The JSON above contains:
- **metadata**: Overall statistics (pattern type, confidence, keywords, occurrence count)
- **patterns**: Array of individual patterns, each with:
  - **id**: Pattern identifier (for reference)
  - **description**: What the pattern describes
  - **confidence**: How reliable this pattern is (0.0-1.0)
  - **occurrences**: How many times this pattern was observed
  - **keywords**: Key terms related to the pattern
  - **evidence.examples**: User corrections (when available) - the actual text users wrote when correcting Claude
  - **user_context**: Additional context from user messages

## Analysis Steps

1. **Group by similarity**: Read all patterns and identify which ones describe the SAME mistake
   - Same root cause? → MERGE into one rule
   - Different root causes? → Keep as SEPARATE rules
   - Look at both **description** and **evidence.examples** to understand the pattern

2. **Extract the pattern**: For each group, identify:
   - What mistake is repeating?
   - Why did Claude get it wrong? (missing knowledge, wrong assumption, oversight)
   - What's the underlying principle being violated?

3. **Generalize carefully**:
   - Find the common thread across examples in **evidence.examples**
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
    return `## How to Read the JSON Data

The JSON above contains:
- **metadata**: Pattern statistics (type, confidence, keywords, occurrences)
- **patterns**: A single pattern with:
  - **description**: What this pattern is about
  - **confidence**: Pattern reliability (0.0-1.0)
  - **evidence.examples**: User corrections - actual text showing what users changed
  - **keywords**: Key terms related to the pattern

## Analysis Steps

1. **Understand the mistake**: Read the **description** and examine **evidence.examples**
   - What did Claude do wrong?
   - What did the user correct it to?
   - What principle was violated?

2. **Extract the rule**:
   - Identify the root cause
   - Generalize from the specific example(s)
   - Stay grounded in the evidence provided

3. **Make it actionable**:
   - Write concrete steps Claude can check
   - Include positive guidance (do this) and warnings (avoid that)
   - Ensure it prevents the specific mistake shown

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
      section += `[{"title":"...","description":"...","rationale":"...","scope":"global","scenes":{"tech":[],"functional":[],"business":[]},"how_to_apply":[...],"when_to_use":[...],"exceptions":[...],"source_patterns":["pattern 1","pattern 2"],"merged_count":2}]\n\n`;
      section += `If all patterns are similar, return 1 rule. If distinct, return multiple rules.\n\n`;
    } else {
      section += `{"title":"...","description":"...","rationale":"...","scope":"global","scenes":{"tech":[],"functional":[],"business":[]},"how_to_apply":[...],"when_to_use":[...],"exceptions":[]}\n\n`;
    }

    section += `Rules:
- title: imperative verb, 60-80 chars
- description: what to do/avoid, 3-5 sentences, specific
- rationale: why (2-4 sentences, concrete benefits/risks)
- scope: rule applicability scope (required, see Scope Determination below)
- scenes: applicable technology/domain context (required, see Scene Tagging below)
- how_to_apply: 3-6 actionable steps (array)
- when_to_use: 3-5 conditions (array)
- exceptions: 2-4 edge cases (array, optional)`;

    if (isBatchMode) {
      section += `\n- source_patterns: original pattern descriptions merged (array)
- merged_count: number of patterns merged into this rule`;
    }

    section += `\n\n## Scope Determination

REQUIRED: Every rule must include a "scope" field with one of these exact values:

**"global"**: Universal programming principles that apply across all languages, frameworks, and projects
- Examples: "Validate user input before processing", "Use meaningful variable names", "Handle errors gracefully"
- Indicators: References general concepts (input validation, error handling, naming conventions)
- No mention of specific libraries, frameworks, or project structures

**"organization"**: Company/team-specific frameworks, conventions, or architectural patterns
- Examples: "Use company auth middleware for all protected routes", "Follow team's React component structure"
- Indicators: Mentions "company", "team", "our", specific framework patterns that are conventional but not universal
- References shared libraries or organizational standards

**"project"**: Specific to current project's implementation details, file paths, or local conventions
- Examples: "Import shared types from src/types/common.ts", "Use ProjectConfig singleton for settings"
- Indicators: Mentions specific file paths, project-specific class names, local implementation details
- References code unique to this codebase

**How to decide:**
1. If the rule would apply to ANY project in ANY language → "global"
2. If the rule requires your company's framework/conventions but could apply to multiple projects → "organization"
3. If the rule references specific files, classes, or implementations unique to this project → "project"

When in doubt, choose the BROADEST applicable scope (prefer global over organization, organization over project).

CRITICAL: The "scope" field is REQUIRED. Always include it in your JSON output.

## Scene Tagging

REQUIRED: Every rule must include a "scenes" field with three dimensions:

**"tech"**: Array of technology stacks/frameworks involved
- Examples: ["react", "typescript", "graphql", "prisma", "nextjs"]
- Include: programming languages, frameworks, libraries, tools mentioned
- Common values: react, vue, angular, typescript, javascript, python, nodejs, express, prisma, graphql, jest, vitest

**"functional"**: Array of functional domains addressed
- Examples: ["auth", "api", "database", "ui", "testing"]
- Include: what area of functionality this rule affects
- Common values: auth, api, database, ui, testing, performance, security, error-handling, state

**"business"**: Array of business domains (if applicable)
- Examples: ["e-commerce", "payment", "crm"]
- Include ONLY if rule is specific to a business domain
- Common values: e-commerce, payment, crm, user-management
- Most rules leave this empty

**How to tag:**
1. **tech**: List all mentioned technologies - be specific (e.g., if React hooks are mentioned, add "react")
2. **functional**: Identify what functional area the rule addresses (authentication? API design? testing?)
3. **business**: Only add if rule is specific to a business domain (most rules leave this empty)

**Examples:**
- "Use parameterized queries to prevent SQL injection in Express APIs"
  → {"tech": ["express", "nodejs"], "functional": ["api", "database", "security"], "business": []}
- "Memoize expensive React component renders with useMemo"
  → {"tech": ["react", "typescript"], "functional": ["ui", "performance"], "business": []}
- "Validate JWT tokens before processing authenticated requests"
  → {"tech": [], "functional": ["auth", "security", "api"], "business": []}

CRITICAL: The "scenes" field is REQUIRED. Always include it with all three dimensions (tech, functional, business).`;

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
