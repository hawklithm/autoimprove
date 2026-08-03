/**
 * Hybrid Rule Generator - Multi-phase rule generation strategy
 *
 * Phase 1: Basic pattern detection (SessionAnalyzer)
 * Phase 2: LLM content enhancement with full context
 * Phase 3: Code example extraction from session tool calls
 * Phase 4: Structured storage with rich metadata
 */

import { Pattern, RuleIndexEntry, RuleContent, Scene, CodeExample, RuleScope } from "./models.js";
import { RuleGenerator } from "./rule-generator.js";
import { CodeExampleExtractor } from "./code-example-extractor.js";
import { ScopeDetector, ScopeContext } from "./scope-detector.js";
import { SceneExtractor } from "./scene-extractor.js";
import { SessionData } from "./jsonl-parser.js";
import { logger } from "./logger.js";
import { tokenizeWithJieba } from "./jieba-utils.js";
import { EmbeddingEncoder } from "./embedding-encoder.js";
import { loadConfig } from "../storage/init.js";
import OpenAI from "openai";
import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { RuleQualityController, UNIFIED_RULE_MIN_SCORE } from "./rule-quality.js";

// Log file path
const LLM_LOG_FILE = join(homedir(), ".autoimprove", "llm-calls.log");

export interface EnhancedRuleOptions {
  /** Whether to use LLM for content enhancement (Phase 2) */
  useLLMEnhancement?: boolean;

  /** Whether to extract code examples from sessions (Phase 3) */
  extractCodeExamples?: boolean;

  /** Path to session files directory */
  sessionDir?: string;

  /** Maximum number of examples to include */
  maxExamples?: number;

  /** Session data for scope detection */
  sessionData?: SessionData;

  /** Classify scope with a dedicated LLM call even when content enhancement is off. */
  useLLMScopeClassification?: boolean;
}

export class HybridRuleGenerator {
  private basicGenerator: RuleGenerator;
  private exampleExtractor: CodeExampleExtractor;
  private scopeDetector: ScopeDetector;
  private openai: OpenAI | null;
  private model: string;
  private qualityController: RuleQualityController;

  constructor() {
    this.basicGenerator = new RuleGenerator();
    this.exampleExtractor = new CodeExampleExtractor();
    this.scopeDetector = new ScopeDetector();
    this.qualityController = new RuleQualityController();

    // Support multiple API key sources: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, LLM_API_KEY
    const apiKey = process.env.ANTHROPIC_API_KEY
      || process.env.ANTHROPIC_AUTH_TOKEN
      || process.env.LLM_API_KEY;

    // Support custom base URL for LLM API
    let baseURL = process.env.LLM_BASE_URL || process.env.ANTHROPIC_BASE_URL;

    // If baseURL doesn't end with /v1, add it (for OpenAI compatibility)
    if (baseURL && !baseURL.endsWith('/v1')) {
      baseURL = baseURL.replace(/\/$/, '') + '/v1';
    }

    // Priority: LLM_MODEL > ANTHROPIC_MODEL > default
    this.model = process.env.LLM_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

    if (!apiKey) {
      this.openai = null;
      logger.debug("hybrid-generator", "No API key found - LLM enhancement disabled");
      return;
    }

    if (baseURL) {
      this.openai = new OpenAI({ apiKey, baseURL });
      logger.debug("hybrid-generator", `LLM initialized: baseURL=${baseURL}, model=${this.model}`);
    } else {
      this.openai = new OpenAI({ apiKey });
      logger.debug("hybrid-generator", `LLM initialized with standard OpenAI, model=${this.model}`);
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
      maxExamples = 3,
      sessionData,
      useLLMScopeClassification = true
    } = options;

    // Phase 1: Generate basic rule
    const basicRule = this.basicGenerator.generateRule(pattern, ruleId, scene);

    // Phase 1.5: Detect and assign scope
    const scopeSessionData = sessionData || (pattern.project_paths?.length === 1
      ? { project_path: pattern.project_paths[0] } as SessionData
      : undefined);
    const scopeContext = this.scopeDetector.detectScope(pattern, scopeSessionData);
    let resolvedScopeConfidence = scopeContext.confidence || 0.5;
    let resolvedScopeReason = scopeContext.reason;
    basicRule.indexEntry.scope = scopeContext.scope;
    basicRule.indexEntry.scope_confidence = resolvedScopeConfidence;
    basicRule.indexEntry.scope_reason = resolvedScopeReason;
    if (scopeContext.project_path || scopeContext.organization_id || scopeContext.project_id) {
      basicRule.indexEntry.scope_context = {
        organization_id: scopeContext.organization_id,
        project_id: scopeContext.project_id,
        project_path: scopeContext.project_path
      };
    }

    // Log scope detection result
    logger.debug("hybrid-generation", `Scope detected for ${ruleId}`, {
      scope: scopeContext.scope,
      project_path: scopeContext.project_path,
      project_id: scopeContext.project_id
    });

    // Scope classification is independent from prose enhancement. This keeps
    // organization/project boundaries accurate even in fast batch mode.
    if (useLLMScopeClassification && this.openai && !useLLMEnhancement) {
      const llmScope = await this.classifyScopeWithLLM(pattern, scopeContext);
      if (llmScope) {
        resolvedScopeConfidence = llmScope.confidence || resolvedScopeConfidence;
        resolvedScopeReason = llmScope.reason || resolvedScopeReason;
        basicRule.indexEntry.scope = llmScope.scope;
        basicRule.indexEntry.scope_confidence = resolvedScopeConfidence;
        basicRule.indexEntry.scope_reason = resolvedScopeReason;
        basicRule.indexEntry.scope_context = {
          organization_id: llmScope.organization_id,
          project_id: llmScope.project_id,
          project_path: llmScope.project_path || scopeContext.project_path
        };
      }
    }

    // Phase 1.6: Extract scenes and keywords from pattern
    const sceneData = await this.extractSceneFromPattern(pattern);
    basicRule.indexEntry.scenes = sceneData.scene;
    basicRule.indexEntry.keywords = sceneData.keywords;

    logger.debug("hybrid-ion", `Scene and keywords extracted for ${ruleId}`, {
      scenes: sceneData.scene,
      keywords: sceneData.keywords
    });

    // Phase 2: LLM enhancement (if enabled and available)
    let enhancedContent: RuleContent & { scope?: RuleScope; scope_context?: any; scope_confidence?: number; scope_reason?: string; scenes?: Scene };
    if (useLLMEnhancement && this.openai) {
      try {
        // Pass Phase 1 scope as preliminary analysis to Phase 2
        const preliminaryScope = {
          scope: scopeContext.scope,
          scopeContext: {
            project_path: scopeContext.project_path,
            project_id: scopeContext.project_id,
            organization_id: scopeContext.organization_id
          }
        };
        enhancedContent = await this.enhanceWithLLM(pattern, basicRule.content, ruleId, preliminaryScope);

        // Phase 2 LLM has final say on scope - override Phase 1 result if LLM provided scope
        if (enhancedContent.scope) {
          basicRule.indexEntry.scope = enhancedContent.scope;
          basicRule.indexEntry.scope_confidence = enhancedContent.scope_confidence || resolvedScopeConfidence;
          basicRule.indexEntry.scope_reason = enhancedContent.scope_reason || resolvedScopeReason;
          logger.info("hybrid-generation", `Scope determined by LLM for ${ruleId}: ${enhancedContent.scope} (confidence: ${enhancedContent.scope_confidence?.toFixed(2) || 'N/A'})`);

          // Update scope_context if LLM provided it
          if (enhancedContent.scope_context) {
            basicRule.indexEntry.scope_context = enhancedContent.scope_context;
          }
        } else {
          logger.warn("hybrid-generation", `LLM did not provide scope for ${ruleId}, keeping Phase 1 result: ${basicRule.indexEntry.scope}`);
        }

        // ✅ NEW: Phase 2 LLM has final say on scenes - override Phase 1.6 result if LLM provided scenes
        if (enhancedContent.scenes) {
          basicRule.indexEntry.scenes = enhancedContent.scenes;
          logger.info("hybrid-generation", `Scenes determined by LLM for ${ruleId}:`, {
            tech: enhancedContent.scenes.tech,
            functional: enhancedContent.scenes.functional,
            business: enhancedContent.scenes.business
          });
        } else {
          // LLM returned no/empty scenes. Phase 1.6 already used the raw
          // pattern text, which can be sparse. Re-derive scenes from the
          // (richer) enhanced content so we don't persist empty scenes.
          const enhancedText = [
            enhancedContent.title,
            enhancedContent.description,
            (enhancedContent.how_to_apply || []).join(' '),
            (enhancedContent.when_to_use || []).join(' '),
            (enhancedContent.exceptions || []).join(' ')
          ].join(' ');

          const sceneExtractor = SceneExtractor.getInstance();
          const reExtracted = sceneExtractor.extractScene({
            text: enhancedText,
            keywords: basicRule.indexEntry.keywords
          });

          // Prefer the re-extracted scenes only if they found something;
          // otherwise fall back to whatever Phase 1.6 produced.
          const hasReExtracted =
            reExtracted.tech.length > 0 ||
            reExtracted.functional.length > 0 ||
            reExtracted.business.length > 0;

          if (hasReExtracted) {
            basicRule.indexEntry.scenes = reExtracted;
            logger.info("hybrid-generation", `Scenes re-derived from enhanced content for ${ruleId}:`, {
              tech: reExtracted.tech,
              functional: reExtracted.functional,
              business: reExtracted.business
            });
          } else {
            logger.warn("hybrid-generation", `LLM did not provide scenes for ${ruleId}, keeping Phase 1.6 result:`, {
              tech: basicRule.indexEntry.scenes.tech,
              functional: basicRule.indexEntry.scenes.functional,
              business: basicRule.indexEntry.scenes.business
            });
          }
        }
      } catch (error) {
        logger.warn("hybrid-generation", `LLM enhancement failed for ${ruleId}, using basic content`, { error: error instanceof Error ? error.message : String(error) });
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
        logger.warn("hybrid-generation", `Code example extraction failed for ${ruleId}`, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    // Phase 4: Unified quality assessment. Evidence confidence, content
    // quality, and scope certainty now produce one persisted score.
    basicRule.indexEntry.description = enhancedContent.description || pattern.description;
    const evidenceConfidence = basicRule.indexEntry.confidence;
    let unifiedScore = this.qualityController.assessUnifiedScore(
      enhancedContent,
      basicRule.indexEntry,
      evidenceConfidence,
      enhancedContent.scope_confidence || resolvedScopeConfidence
    );
    let qualityScore = unifiedScore.overall;

    // Downgrade confidence for low-quality rules
    if (qualityScore < UNIFIED_RULE_MIN_SCORE) {
      logger.warn("hybrid-generation", `⚠️  Rule ${ruleId} has low quality score: ${qualityScore.toFixed(2)}`);
      basicRule.indexEntry.confidence = Math.min(
        basicRule.indexEntry.confidence,
        0.4 + qualityScore * 0.2  // Cap at 0.4-0.5 for low quality
      );

      // A weak model response must not be allowed to replace a useful
      // deterministic rule with a copied session request/summary. When the
      // basic generator has a reusable rule, use it as a safe fallback.
      const fallback = this.createFallbackContent(basicRule.content, pattern);
      if (fallback) {
        enhancedContent = fallback;
        unifiedScore = this.qualityController.assessUnifiedScore(
          enhancedContent,
          basicRule.indexEntry,
          evidenceConfidence,
          enhancedContent.scope_confidence || resolvedScopeConfidence
        );
        qualityScore = unifiedScore.overall;
        logger.info("hybrid-generation", `Using deterministic fallback for ${ruleId} after low-quality LLM response`, {
          quality_score: qualityScore
        });
      }
    }

    // Add quality metadata
    if (!enhancedContent.metadata) {
      enhancedContent.metadata = {
        type: basicRule.indexEntry.type,
        priority: basicRule.indexEntry.priority,
        confidence: basicRule.indexEntry.confidence,
        source: "learned",
        pattern_occurrences: pattern.occurrences.length,
        first_seen: pattern.first_seen,
        last_seen: pattern.last_seen,
        keywords: pattern.keywords
      };
    }
    basicRule.indexEntry.confidence = qualityScore;
    enhancedContent.metadata.quality_score = qualityScore;
    enhancedContent.metadata.evidence_confidence = unifiedScore.evidence_confidence;
    enhancedContent.metadata.content_quality = unifiedScore.clarity * 0.4 + unifiedScore.specificity * 0.3 + unifiedScore.actionability * 0.3;
    // Keep the persisted content metadata aligned with the index entry. The
    // exporter filters index confidence, so stale metadata is misleading.
    enhancedContent.metadata.confidence = basicRule.indexEntry.confidence;

    // Add scope metadata from LLM if available
    if (enhancedContent.scope_confidence !== undefined) {
      enhancedContent.metadata.scope_confidence = enhancedContent.scope_confidence;
    } else {
      enhancedContent.metadata.scope_confidence = resolvedScopeConfidence;
    }
    if (enhancedContent.scope_reason) {
      enhancedContent.metadata.scope_reason = enhancedContent.scope_reason;
    } else if (resolvedScopeReason) {
      enhancedContent.metadata.scope_reason = resolvedScopeReason;
    }

    // ✅ NEW: Sync scenes from indexEntry to metadata (ensure consistency)
    enhancedContent.metadata.scenes = basicRule.indexEntry.scenes;

    // Phase 5: Return structured rule with rich metadata
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
    const filteredReasons: Record<string, number> = {};

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const ruleId = `rule-${String(startId + i).padStart(3, "0")}`;

      // Check if should generate rule
      const { shouldGenerate, reason } = this.basicGenerator["classifier"].shouldGenerateRule(pattern);
      if (!shouldGenerate) {
        // Track filtering reasons for diagnostics
        filteredReasons[reason] = (filteredReasons[reason] || 0) + 1;

        // Log first 3 filtered patterns for debugging
        if (i < 3) {
          logger.debug("hybrid-generation", `✗ Filtered pattern ${i}: ${reason}`);
          logger.debug("hybrid-generation", `  Type: ${pattern.type}, Confidence: ${pattern.confidence}, Occurrences: ${pattern.occurrences.length}`);
        }
        continue;
      }

      const rule = await this.generateEnhancedRule(pattern, ruleId, scene, options);
      rules.push(rule);

      logger.info("hybrid-generation", `✓ Generated enhanced rule ${ruleId}: ${rule.content.title || pattern.description}`);
    }

    // Log filtering statistics
    if (Object.keys(filteredReasons).length > 0) {
      logger.info("hybrid-generation", `\n=== Rule Filtering Statistics ===`);
      logger.info("hybrid-generation", `Total patterns: ${patterns.length}`);
      logger.info("hybrid-generation", `Rules generated: ${rules.length}`);
      logger.info("hybrid-generation", `Patterns filtered: ${patterns.length - rules.length}`);
      logger.info("hybrid-generation", `Filtering reasons:`);
      for (const [reason, count] of Object.entries(filteredReasons)) {
        logger.info("hybrid-generation", `  - ${reason}: ${count} patterns`);
      }

      logger.warn(
        "rule-generation",
        `Filtered ${patterns.length - rules.length} patterns`,
        { filtered_reasons: filteredReasons }
      );
    }

    return rules;
  }

  /**
   * Phase 2: Enhance rule content with LLM
   */
  private async classifyScopeWithLLM(pattern: Pattern, fallback: ScopeContext): Promise<ScopeContext | null> {
    if (!this.openai) return null;
    const evidence = pattern.occurrences.slice(-5).map((occurrence, index) =>
      `${index + 1}. user=${occurrence.user_input || ""}; context=${occurrence.context || ""}`
    ).join("\n");
    const prompt = `Classify the applicability scope of this coding rule. Return JSON only.
Allowed scope values:
- global: broadly valid across unrelated projects
- organization: depends on a team's internal system, private package, shared middleware, company convention, or organization-wide tooling
- project: depends on one repository's code, custom module, file layout, business workflow, or project-only implementation
Prefer the narrowest scope supported by evidence. Do not classify a generic best practice as project or organization merely because it was observed in one project.
Return: {"scope":"global|organization|project","confidence":0.0,"reason":"...","organization_id":"...","project_id":"..."}
Rule: ${pattern.description}
Keywords: ${pattern.keywords.join(", ")}
Observed project roots: ${(pattern.project_paths || []).join(", ") || "unknown"}
Evidence:\n${evidence}`;
    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }]
      });
      const text = response.choices[0]?.message?.content || "";
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : text) as Record<string, any>;
      const scope = parsed.scope;
      if (![RuleScope.GLOBAL, RuleScope.ORGANIZATION, RuleScope.PROJECT].includes(scope)) return fallback;
      return {
        scope,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || fallback.confidence || 0.5)),
        reason: typeof parsed.reason === "string" ? parsed.reason : fallback.reason,
        organization_id: parsed.organization_id || fallback.organization_id,
        project_id: parsed.project_id || fallback.project_id,
        project_path: fallback.project_path
      };
    } catch (error) {
      logger.warn("hybrid-generation", "LLM scope classification failed; using heuristic scope", {
        error: error instanceof Error ? error.message : String(error)
      });
      return fallback;
    }
  }

  private async enhanceWithLLM(
    pattern: Pattern,
    basicContent: RuleContent,
    ruleId: string,
    preliminaryScope?: { scope: RuleScope; scopeContext?: any }
  ): Promise<RuleContent & { scope?: RuleScope; scope_context?: any; scope_confidence?: number; scope_reason?: string; scenes?: Scene }> {
    if (!this.openai) {
      throw new Error("OpenAI client not initialized");
    }

    // Build enhancement prompt with full pattern context and preliminary scope
    const prompt = this.buildEnhancementPrompt(pattern, basicContent, preliminaryScope);

    // Dynamic max_tokens based on pattern complexity (add tokens for scope analysis)
    const maxTokens = this.calculateMaxTokens(pattern) + 200;

    const requestLog = `\n[${new Date().toISOString()}] [LLM] Requesting enhancement for ${ruleId}\n` +
      `Model: ${this.model}, Max tokens: ${maxTokens}\n` +
      `Prompt (${prompt.length} chars):\n${prompt.slice(0, 500)}...\n`;

    logger.debug("hybrid-generation", "LLM request sent", { rule_id: ruleId, model: this.model, max_tokens: maxTokens, prompt_length: prompt.length });
    appendFileSync(LLM_LOG_FILE, requestLog, "utf8");

    const response = await this.openai.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{
        role: "user",
        content: prompt
      }]
    });

    const responseText = response.choices[0]?.message?.content || "";

    // Log cache performance metrics
    const cacheStats = this.extractCacheStats(response);
    const responseLog = `[${new Date().toISOString()}] [LLM] Response received (${responseText.length} chars):\n${responseText.slice(0, 500)}...\n` +
      `Usage: ${JSON.stringify(cacheStats)}\n`;
    logger.debug("hybrid-generation", "LLM response received", { rule_id: ruleId, response_length: responseText.length, cache_stats: cacheStats });
    appendFileSync(LLM_LOG_FILE, responseLog, "utf8");

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
      related_rules: enhanced.related_patterns,
      scope: enhanced.scope,
      scope_context: enhanced.scope_context,
      scope_confidence: enhanced.scope_confidence,
      scope_reason: enhanced.scope_reason,
      scenes: enhanced.scenes  // ✅ NEW: return scenes from LLM
    };
  }

  /**
   * Build enhancement prompt (optimized for token efficiency and cache hit rate)
   *
   * CACHE OPTIMIZATION: Static instructions (~1400 tokens) are placed first,
   * followed by dynamic pattern data (~400-600 tokens) at the end.
   */
  private buildEnhancementPrompt(
    pattern: Pattern,
    basicContent: RuleContent,
    preliminaryScope?: { scope: RuleScope; scopeContext?: any }
  ): string {
    // Step 1: Build static instructions (cacheable)
    const staticInstructions = `# Coding Rule Enhancement System

## Task 1: Scope Determination

Analyze if this rule is:
- "global": Universal pattern applicable to all projects
- "organization": Company-specific framework/convention
- "project": Project-specific implementation

Indicators for GLOBAL:
- Programming principles (SOLID, DRY, KISS)
- Common security vulnerabilities (SQL injection, XSS, CSRF)
- Universal performance patterns (memory leaks, race conditions)
- Standard error handling practices
- Generic naming conventions

Indicators for PROJECT:
- References "this project", "this codebase", "this repository"
- Mentions specific custom modules/services unique to one codebase
- Low occurrence count (1-2) with specific file paths
- Custom implementation details

Indicators for ORGANIZATION:
- Explicitly mentions "our team", "company standard", "org-wide"
- Framework choices consistent across multiple projects
- Shared tooling/linting configurations

## Task 2: Scene Detection

Identify the technical context in 3 dimensions:

1. **tech** (array): Technologies/frameworks/languages involved
   Examples: ["react", "typescript", "nodejs", "python", "sql", "graphql", "prisma", "nextjs", "express"]
   Extract from: file extensions (.tsx→react, .py→python), framework names, library references

2. **functional** (array): Functional/technical domains
   Examples: ["auth", "api", "database", "testing", "error-handling", "performance", "security", "state-management"]
   Extract from: what the code does (authentication, API calls, database queries, etc.)

3. **business** (array): Business/product domains (often empty for technical rules)
   Examples: ["e-commerce", "payment", "analytics", "user-management"]
   Extract from: business context mentioned by user

Guidelines:
- Include 2-4 items per dimension (don't over-specify)
- Use lowercase, hyphenated names (e.g., "error-handling" not "Error Handling")
- Focus on what's explicitly mentioned or clearly implied
- tech + functional are usually non-empty; business often empty for technical rules

MANDATORY: You MUST populate the "tech" and "functional" dimensions from the evidence above. Scan the pattern type, keywords, file paths, and user correction text for any matching technology or functional domain (e.g., "test"/"mock" → functional:["testing"], ".ts" file → tech:["typescript"], "auth"/"login" → functional:["auth"], "api"/"endpoint" → functional:["api"]). Only set a dimension to an empty array if NOTHING in the evidence relates to it. Never return all-empty scenes.

Example (for a rule about testing React hooks):
"scenes": {"tech":["react","typescript"],"functional":["testing","ui","hooks"],"business":[]}

## Output Format

Return JSON with these fields:
- title: imperative, 60-80 chars
- description: what to do/avoid, 4-6 sentences, specific
- rationale: why this matters, 3-5 sentences, concrete
- how_to_apply: 4-6 actionable steps (array)
- when_to_use: 3-5 conditions (array)
- exceptions: 2-4 cases (array, optional)
- related_patterns: related rule names (array, optional)
- scope: "global" | "organization" | "project" (REQUIRED)
- scope_confidence: 0.0-1.0, how certain are you about the scope (REQUIRED)
- scope_reason: 1-2 sentences explaining why you chose this scope (REQUIRED)
- scope_context: object with organization_id, project_id, project_path if scope is organization/project (optional)
- scenes: {"tech":[],"functional":[],"business":[]} (REQUIRED)

Be specific and actionable.`;

    // Step 2: Extract dynamic pattern data
    const contextExamples = pattern.occurrences
      .filter(o => o.user_input && o.user_input.length > 20)
      .slice(-5)  // Last 5 meaningful occurrences
      .map((o, i) => {
        let example = `${i + 1}. User: ${o.user_input}`;

        // Add context if available
        if (o.context && o.context !== "unknown") {
          example += `\n   Context: ${o.context}`;
        }

        // Add action type
        const actionMap: Record<string, string> = {
          "explicit_correction": "Corrected",
          "accept": "Accepted",
          "reject": "Rejected",
          "amend": "Amended",
          "undo": "Undone"
        };
        const actionLabel = actionMap[o.user_action] || o.user_action;
        example += `\n   Action: ${actionLabel}`;

        // Add metadata hints
        if (o.security_issue) {
          example += `\n   Security: ${o.security_issue}`;
        }
        if (o.performance_improved) {
          example += `\n   Performance: Improved`;
        }

        return example;
      })
      .join('\n\n');

    // Fallback to description if no user inputs
    const contextToUse = contextExamples || `Pattern description: ${pattern.description}`;

    // Build scope analysis context
    const scopeContext = preliminaryScope
      ? `\nPreliminary Scope Analysis (Phase 1):
- Detected: ${preliminaryScope.scope}
- Project: ${preliminaryScope.scopeContext?.project_path || 'N/A'}
- Project ID: ${preliminaryScope.scopeContext?.project_id || 'N/A'}
- Organization: ${preliminaryScope.scopeContext?.organization_id || 'N/A'}`
      : '';

    // Extract file paths from occurrences for scene hints
    const filePaths = pattern.occurrences
      .map(o => o.context)
      .filter(ctx => ctx && ctx !== "unknown")
      .slice(0, 5);
    const filePathsHint = filePaths.length > 0
      ? `\nFile paths: ${filePaths.join(', ')}`
      : '';

    // Step 3: Combine static + dynamic (enables caching of static part)
    return `${staticInstructions}

---

## Input Data for This Enhancement Request

**Pattern Type**: ${pattern.type}
**Confidence**: ${(pattern.confidence * 100).toFixed(0)}%
**Occurrences**: ${pattern.occurrences.length}
**Keywords**: ${pattern.keywords.slice(0, 5).join(', ')}

**Basic Rule Content**:
${basicContent.content.slice(0, 200)}...

**Evidence from Sessions**:
${contextToUse}
${scopeContext}
${filePathsHint}

Generate enhanced rule following the format specified above.`;
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
    scope?: RuleScope;
    scope_confidence?: number;
    scope_reason?: string;
    scope_context?: {
      organization_id?: string;
      project_id?: string;
      project_path?: string;
    };
    scenes?: Scene;  // ← Added: LLM-detected scenes
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

      // Validate scope fields
      if (parsed.scope && !["global", "organization", "project"].includes(parsed.scope)) {
        logger.warn("hybrid-generation", `Invalid scope value: ${parsed.scope}, defaulting to global`);
        parsed.scope = "global";
      }

      // Validate and normalize scenes
      let scenes: Scene | undefined;
      if (parsed.scenes) {
        // Normalize scene arrays (ensure they are arrays)
        scenes = {
          tech: Array.isArray(parsed.scenes.tech) ? parsed.scenes.tech : [],
          functional: Array.isArray(parsed.scenes.functional) ? parsed.scenes.functional : [],
          business: Array.isArray(parsed.scenes.business) ? parsed.scenes.business : []
        };

        // Validate scene has at least one dimension
        if (scenes.tech.length === 0 && scenes.functional.length === 0 && scenes.business.length === 0) {
          logger.warn("hybrid-generation", `LLM returned empty scenes, will use fallback extraction`);
          scenes = undefined;
        }
      }

      return {
        title: parsed.title,
        description: parsed.description,
        rationale: parsed.rationale,
        how_to_apply: parsed.how_to_apply || [],
        when_to_use: parsed.when_to_use || [],
        exceptions: parsed.exceptions,
        related_patterns: parsed.related_patterns,
        scope: parsed.scope as RuleScope,
        scope_confidence: typeof parsed.scope_confidence === 'number' ? parsed.scope_confidence : undefined,
        scope_reason: parsed.scope_reason,
        scope_context: parsed.scope_context,
        scenes: scenes  // ← Added: return parsed scenes
      };
    } catch (error) {
      // Log detailed error information with full response string
      const errorLog = `\n[${new Date().toISOString()}] [LLM] JSON Parse Error\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}\n` +
        `=== FULL RESPONSE STRING (${response.length} chars) ===\n` +
        `${response}\n` +
        `=== END RESPONSE ===\n`;

      logger.consoleError(errorLog);
      appendFileSync(LLM_LOG_FILE, errorLog, "utf8");

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

  /**
   * Assess rule quality based on multiple dimensions
   * Returns a score between 0.0 (very poor) and 1.0 (excellent)
   */
  private assessRuleQuality(content: RuleContent): number {
    let score = 0;
    let maxScore = 0;

    // 1. Description completeness (0-0.3)
    maxScore += 0.3;
    if (content.description) {
      const desc = content.description;

      // These are session artifacts, not reusable rules. They should fail
      // quality assessment even when they happen to be long enough.
      if (/this session is being continued from|summary below covers the earlier portion|帮忙梳理|请帮我|帮我看看/i.test(desc)) {
        score += 0;
      }

      // Check for truncation markers
      if (desc.includes("...") || desc.includes("…")) {
        score += 0.05;  // Truncated, very low score
      }
      // Check for corrupted text (乱码, HTML tags, JSON fragments)
      else if (/[^\x00-\x7F]{3,}/.test(desc) && !/[一-龥]{3,}/.test(desc)) {
        score += 0.05;  // Garbled text
      }
      else if (/<[^>]+>/.test(desc) || /\{["\w]+:/.test(desc)) {
        score += 0.1;  // Contains HTML/JSON
      }
      // Check minimum length
      else if (desc.length < 50) {
        score += 0.1;  // Too short
      }
      // Full marks for complete description
      else if (desc.length >= 100 && desc.length <= 500) {
        score += 0.3;
      }
      // Partial marks for reasonable length
      else if (desc.length >= 50) {
        score += 0.2;
      }
    }

    // 2. Rationale/Reason quality (0-0.2)
    maxScore += 0.2;
    if (content.reason) {
      const reason = content.reason;

      // Check for meaningful content (not just pattern metadata)
      if (reason.includes("Corrected") && reason.includes("times in") && reason.length < 100) {
        score += 0.05;  // Auto-generated metadata, not real rationale
      }
      else if (reason.length >= 50 && !reason.includes("...")) {
        score += 0.2;
      }
      else if (reason.length >= 20) {
        score += 0.1;
      }
    }

    // 3. Actionable steps (0-0.2)
    maxScore += 0.2;
    if (content.how_to_apply && content.how_to_apply.length > 0) {
      const steps = content.how_to_apply;

      // Check if steps are generic or specific
      const hasSpecificSteps = steps.some(step =>
        step.length > 20 && (
          /\w+\(/.test(step) ||  // Contains function calls
          /`[^`]+`/.test(step) ||  // Contains code
          /\b(check|verify|add|remove|use|call|import|export)\b/i.test(step)  // Action verbs
        )
      );

      if (hasSpecificSteps && steps.length >= 3) {
        score += 0.2;
      } else if (steps.length >= 2) {
        score += 0.1;
      } else {
        score += 0.05;
      }
    }

    // 4. Code examples (0-0.2)
    maxScore += 0.2;
    if (content.examples && content.examples.length > 0) {
      const example = content.examples[0];

      // Check if examples are real code (not fragments)
      if (example.good && example.good.length > 20 && !example.good.includes("...")) {
        score += 0.15;
        // Bonus for having both good and bad examples
        if (example.bad && example.bad.length > 20) {
          score += 0.05;
        }
      }
    }

    // 5. Content formatting (0-0.1)
    maxScore += 0.1;
    const formattedContent = content.content || "";

    // Check for proper markdown structure
    const hasHeaders = /^#{1,3}\s+\w+/m.test(formattedContent);
    const hasLists = /^[\*\-]\s+\w+/m.test(formattedContent);
    const hasCodeBlocks = /```[\w]*\n/.test(formattedContent);

    if (hasHeaders && (hasLists || hasCodeBlocks)) {
      score += 0.1;
    } else if (hasHeaders) {
      score += 0.05;
    }

    return score / maxScore;  // Normalize to 0-1
  }

  private createFallbackContent(
    basicContent: RuleContent,
    pattern: Pattern
  ): RuleContent | null {
    const raw = basicContent.content || "";
    if (!raw || /requires further refinement|this session is being continued from|summary below covers/i.test(raw)) {
      return null;
    }

    const typeLabel = pattern.type.replace(/-/g, " ");
    const heading = raw.match(/^\*\*([^*]+)\*\*/m)?.[1]?.trim();
    return {
      ...basicContent,
      title: heading ? `Apply ${heading} consistently` : `Apply the learned ${typeLabel} principle consistently`,
      description: raw,
      reason: `This reusable ${typeLabel} practice was observed in user corrections. Applying it consistently reduces repeated rework and keeps related code paths predictable.`,
      how_to_apply: [
        "Identify the affected code path before making the change.",
        "Apply the principle consistently across related call sites and files.",
        "Run the relevant tests or verification checks after the change."
      ],
      when_to_use: [
        "When working in the same technical or functional scene as this pattern.",
        "When a similar correction or failure mode appears again."
      ],
      metadata: {
        ...basicContent.metadata,
        source: "learned-deterministic-fallback"
      }
    };
  }

  /**
   * Calculate dynamic max_tokens based on pattern complexity
   */
  private calculateMaxTokens(pattern: Pattern): number {
    // Security patterns need more detailed explanations
    if (pattern.type === "security") {
      return 1500;
    }

    // High confidence + many occurrences = important rule
    if (pattern.confidence >= 0.8 && pattern.occurrences.length >= 5) {
      return 1200;
    }

    // Simple preferences with few occurrences
    if (pattern.type === "preference" && pattern.occurrences.length < 3) {
      return 700;
    }

    // Anti-patterns need good explanations
    if (pattern.type === "anti-pattern") {
      return 1200;
    }

    // Default: moderate complexity
    return 900;
  }

  /**
   * Extract scene and keywords from pattern
   */
  private async extractSceneFromPattern(pattern: Pattern): Promise<{ scene: Scene; keywords: string[] }> {
    const sceneExtractor = SceneExtractor.getInstance();

    // Collect all text from pattern for analysis
    const texts: string[] = [];
    const filePaths: string[] = [];

    // Add description
    if (pattern.description) {
      texts.push(pattern.description);
    }

    // Add type/category so keyword matching has more signal
    // (e.g. "security" type reinforces security scenes)
    if (pattern.type) {
      texts.push(pattern.type);
    }
    if ((pattern as any).category) {
      texts.push((pattern as any).category);
    }

    // Add user inputs and contexts from occurrences
    for (const occurrence of pattern.occurrences) {
      if (occurrence.user_input) {
        texts.push(occurrence.user_input);
      }
      if (occurrence.context && occurrence.context !== "unknown") {
        filePaths.push(occurrence.context);
      }
    }

    // Use unified SceneExtractor (with caching)
    const scene = sceneExtractor.extractScene({
      text: texts.join(' '),
      filePaths: filePaths,
      keywords: pattern.keywords
    });

    // Extract keywords (important terms from pattern)
    const keywords = new Set<string>();

    // Add pattern type as keyword
    keywords.add(pattern.type);

    // Add existing keywords from pattern
    if (pattern.keywords) {
      pattern.keywords.forEach(kw => keywords.add(kw));
    }

    // Extract keywords via semantic relevance scoring.
    // Uses EmbeddingEncoder to compute cosine similarity between the combined
    // pattern text and each candidate term, then selects the top-K most
    // semantically relevant terms. This is superior to frequency-based
    // extraction because a term that appears only once but is highly specific
    // (e.g. "novel_id", "fix_exclamation") will rank higher than common filler
    // that happens to appear multiple times (e.g. "function", "need").
    const combinedText = texts.join(' ');
    const semanticKeywords = await this.extractSemanticKeywords(combinedText, 10);
    semanticKeywords.forEach(kw => keywords.add(kw));

    // Add tech and functional domains as keywords
    scene.tech.forEach(t => keywords.add(t));
    scene.functional.forEach(f => keywords.add(f));

    return {
      scene,
      keywords: Array.from(keywords).slice(0, 15) // Limit to 15 keywords
    };
  }

  /**
   * Extract semantically relevant keywords from text using EmbeddingEncoder.
   *
   * Strategy: tokenize text into candidate terms (English identifiers + jieba
   * Chinese tokens), encode each candidate and the full text as vectors, then
   * compute cosine similarity. The top-K terms with highest similarity to the
   * full text are the most semantically representative keywords.
   *
   * This is better than frequency-based extraction because:
   * - A rare but highly specific term (e.g. "novel_id") ranks higher than
   *   common filler (e.g. "function", "need") that happens to appear often
   * - Chinese terms segmented by jieba get proper multi-character tokens
   * - Stop words naturally rank low since their vectors are dissimilar to
   *   the technical/specific text
   */
  private async extractSemanticKeywords(text: string, maxKeywords: number = 10): Promise<string[]> {
    if (!text || text.trim().length < 3) return [];

    const lowerText = text.toLowerCase();
    const candidates = new Set<string>();

    // English identifiers (camelCase, PascalCase, snake_case)
    const identifierRegex = /\b([a-z][a-zA-Z0-9_]*|[A-Z][a-zA-Z0-9]*)\b/g;
    const matches = lowerText.match(identifierRegex);
    if (matches) {
      for (const m of matches) {
        if (m.length > 3 && !['this', 'that', 'from', 'with', 'have', 'should', 'need', 'must', 'can', 'use', 'get', 'set'].includes(m)) {
          candidates.add(m);
        }
      }
    }

    // Chinese tokens via jieba
    const hasChinese = /[一-鿿㐀-䶿]/.test(lowerText);
    if (hasChinese) {
      const jiebaTokens = tokenizeWithJieba(lowerText, 2);
      const stopWords = new Set([
        '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
        '这', '个', '上', '来', '说', '到', '要', '可以', '里', '着', '我们',
        '他们', '它', '那', '什么', '怎么', '为什么', '这个', '那个', '一个',
        '没有', '不是', '但是', '如果', '因为', '所以', '而且', '或者', '虽然',
        '已经', '可以', '应该', '需要', '可能', '然后', '之后', '时候', '问题',
        '方法', '方式', '情况', '结果', '信息', '内容', '东西', '事情', '使用',
        '一个', '一下', '一些', '一种', '通过', '进行', '以及', '用于', '具有',
        '还有', '没有', '不是', '就是', '只是', '但是', '还是', '或者', '而且',
      ]);
      for (const t of jiebaTokens) {
        if (t.length >= 2 && !stopWords.has(t) && !/^\d+$/.test(t)) {
          candidates.add(t);
        }
      }
    }

    if (candidates.size === 0) return [];
    if (candidates.size === 1) return [Array.from(candidates)[0]];

    // Build encoder (reuse config from constructor context)
    const cfg = loadConfig().local_ml;
    const encoder = new EmbeddingEncoder({
      backend: (cfg?.embedding_backend as any) || "char-ngram-tfidf",
    });

    try {
      // Encode the full text once
      const textVec = await encoder.encode(text);
      const candidateArr = Array.from(candidates);

      // Encode all candidates in a batch
      const candidateVecs = await encoder.encodeBatch(candidateArr);

      // Score each candidate by cosine similarity to the full text
      const scored = candidateArr.map((term, i) => ({
        term,
        score: EmbeddingEncoder.cosine(textVec, candidateVecs[i]),
      }));

      // Sort by score descending, take top-K
      const topK = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, maxKeywords)
        .map(s => s.term);

      logger.debug("hybrid-keywords", `Semantic keywords: [${topK.join(", ")}] (from ${candidateArr.length} candidates)`);
      return topK;
    } catch {
      // Fallback: return candidates sorted by length (longer = more specific)
      logger.warn("hybrid-keywords", "EmbeddingEncoder failed, falling back to length-based keyword extraction");
      return Array.from(candidates)
        .sort((a, b) => b.length - a.length)
        .slice(0, maxKeywords);
    }
  }

  /**
   * Extract cache performance metrics from OpenAI API response
   */
  private extractCacheStats(response: any): {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } {
    const usage = response.usage || {};
    return {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0
    };
  }
}
