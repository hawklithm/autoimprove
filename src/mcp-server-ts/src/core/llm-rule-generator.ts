/**
 * LLM-based rule generator - generates rules from pattern clusters
 */

import OpenAI from "openai";
import { SignalDictionaryDB, LabeledContent } from "../storage/signal-dictionary-db.js";
import { PatternCluster } from "./pattern-clusterer.js";
import { PatternType, Priority, RuleScope, RuleIndexEntry, RuleContent, Scene, createScene } from "./models.js";
import { logger } from "./logger.js";
import { LLMPromptBuilder, PromptEvidence } from "./llm-prompt-builder.js";
import { JSONExtractor } from "./json-extractor.js";
import { SceneExtractor } from "./scene-extractor.js";
import { LLMConfigManager } from "./llm-config-manager.js";
import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { RuleQualityController } from "./rule-quality.js";
import { MemoryRepository } from "./memory-models.js";
import { createDefaultMemoryRepository } from "../storage/memory-sqlite-store.js";
import {
  computeMemorySupportScore,
  resolveMemorySupport,
  findRelevantMemoryIds,
} from "./memory-support.js";

// Log file path
const LLM_LOG_FILE = join(homedir(), ".autoimprove", "llm-calls.log");

export interface GeneratedRule {
  id: string;
  title: string;
  description: string;
  rationale: string;
  scope: "global" | "organization" | "project";  // Rule applicability scope
  scope_confidence?: number;
  scope_reason?: string;
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
  /** Memory ids backing this rule, resolved from the source cluster (passthrough). */
  source_memory_ids?: string[];
  evidence_count: number;
  scenes: Scene;  // Use standard Scene type (tech, functional, business)
  confidence: number;
  priority: "critical" | "high" | "medium" | "low";
  patternType: PatternType;
  created_at: string;
  last_validated: string;
}

export class LLMRuleGenerator {
  private db: SignalDictionaryDB;
  private llmManager: LLMConfigManager;
  private memoryStore?: MemoryRepository;

  constructor(memoryStore?: MemoryRepository) {
    this.db = new SignalDictionaryDB();
    this.llmManager = new LLMConfigManager();
    this.memoryStore = memoryStore;
  }

  /** Lazily open the memory repository so callers that don't pass one still get real memory support. */
  private getMemoryRepo(): MemoryRepository | null {
    if (this.memoryStore) return this.memoryStore;
    try {
      this.memoryStore = createDefaultMemoryRepository();
      return this.memoryStore;
    } catch (error) {
      logger.warn("llm-generation", "Memory repository unavailable, falling back to heuristic memory support", {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
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

    // Build unified prompt using LLMPromptBuilder with detailed content
    const evidence: PromptEvidence[] = [
      LLMPromptBuilder.contentToEvidence(
        fullContents,
        cluster.representative_description || cluster.common_signals.join(", "),
        cluster.avg_confidence,
        cluster.common_signals
      )
    ];

    const prompt = LLMPromptBuilder.buildPrompt(evidence, {
      patternType: cluster.pattern_type,
      avgConfidence: cluster.avg_confidence,
      commonKeywords: cluster.common_signals,
      totalOccurrences: cluster.total_occurrences,
      sessionCount: cluster.session_count,
      isBatchMode: false,  // Single cluster mode
      maxContentExamples: 5,
      outputLanguage: this.llmManager.getDefaultRuleLanguage()
    });

    // Dynamic max_tokens based on complexity
    const maxTokens = this.calculateMaxTokens(cluster);

    try {
      if (!this.llmManager.isAvailable()) {
        throw new Error("No LLM configurations available");
      }

      const response = await this.llmManager.callWithFallback(async (client, model) => {
        const requestLog = `\n[${new Date().toISOString()}] [LLM] Requesting rule generation for ${ruleId}\n` +
          `Model: ${model}, Max tokens: ${maxTokens}\n` +
          `Prompt (${prompt.length} chars):\n${prompt.slice(0, 500)}...\n`;

        logger.info("llm-generation", requestLog);
        appendFileSync(LLM_LOG_FILE, requestLog, "utf8");

        return await client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          messages: [{
            role: "user",
            content: prompt
          }]
        });
      }, { fallbackOnError: true });

      let responseText = response.choices[0]?.message?.content || "";

      // Log cache performance metrics
      const cacheStats = this.extractCacheStats(response);
      const responseLog = `[${new Date().toISOString()}] [LLM] Response received (${responseText.length} chars):\n${responseText.slice(0, 500)}...\n` +
        `Cache stats: ${JSON.stringify(cacheStats)}\n`;
      logger.info("llm-generation", responseLog);
      appendFileSync(LLM_LOG_FILE, responseLog, "utf8");

      // Recover from truncated responses instead of discarding the rule.
      // A single bounded retry with a larger token budget and a continuation
      // instruction usually yields a complete JSON object.
      if (JSONExtractor.isTruncated(responseText)) {
        logger.warn("llm-generation", "Response truncated, retrying with continuation prompt", { ruleId });
        try {
          const retryResponse = await this.llmManager.callWithFallback(async (client, model) => {
            return await client.chat.completions.create({
              model,
              max_tokens: Math.max(maxTokens, 2000),
              messages: [{
                role: "user",
                content: prompt + "\n\nIMPORTANT: 你上一次的回复被截断了。请现在直接输出【完整】的规则 JSON 对象，不要重复前面的指令。"
              }]
            });
          }, { fallbackOnError: true });
          const retryText = retryResponse.choices[0]?.message?.content || "";
          if (!JSONExtractor.isTruncated(retryText) && retryText.trim().length > responseText.trim().length) {
            responseText = retryText;
          } else {
            logger.warn("llm-generation", "Truncation retry did not improve response, using partial output", { ruleId });
          }
        } catch (retryError) {
          logger.warn("llm-generation", "Truncation retry failed, using partial response", {
            ruleId,
            error: retryError instanceof Error ? retryError.message : String(retryError)
          });
        }
      }

      const parsed = this.parseRuleResponse(responseText);

      // Extract scenes from cluster if LLM didn't provide them
      let scenes: Scene;
      if (parsed.scenes) {
        scenes = parsed.scenes;
      } else {
        // Fallback: extract scenes from cluster content
        scenes = this.extractScenesFromCluster(cluster, fullContents);
        logger.debug("llm-generation", `LLM did not provide scenes, extracted from content`, { scenes });
      }

      // Extract session IDs from labeled content
      const sessionIds = new Set(fullContents.map(c => c.session_id));

      const now = new Date().toISOString();

      // Resolve the promoted memories backing this cluster so the memory link
      // can be passed through into rule generation (and drive the real
      // memory-support score). Prefer ids already attached to the cluster;
      // otherwise discover them from the cluster's representative text.
      const repo = this.getMemoryRepo();
      const sourceMemoryIds = cluster.source_memory_ids && cluster.source_memory_ids.length
        ? cluster.source_memory_ids
        : repo
          ? findRelevantMemoryIds(
              repo,
              cluster.representative_description || cluster.common_signals.join(", ")
            )
          : [];

      return {
        id: ruleId,
        title: parsed.title,
        description: parsed.description,
        rationale: parsed.rationale,
        scope: parsed.scope,
        scope_confidence: parsed.scope_confidence,
        scope_reason: parsed.scope_reason,
        how_to_apply: parsed.how_to_apply,
        examples: parsed.examples,
        when_to_use: parsed.when_to_use,
        exceptions: parsed.exceptions,
        related_patterns: parsed.related_patterns,
        source_cluster_id: cluster.cluster_id,
        source_signals: cluster.common_signals,
        source_sessions: Array.from(sessionIds),
        source_memory_ids: sourceMemoryIds,
        evidence_count: cluster.total_occurrences,
        scenes: scenes,
        confidence: cluster.avg_confidence,
        priority: this.determinePriority(cluster),
        patternType: cluster.pattern_type,
        created_at: now,
        last_validated: now
      };
    } catch (error) {
      logger.warn("llm-generation", "LLM rule generation failed", { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Batch generate rules from multiple clusters.
   *
   * Runs cluster generations in parallel (instead of serial await) to cut
   * wall-clock time, while preserving output order and isolating per-cluster
   * failures (a failed cluster returns null and is filtered out).
   */
  async batchGenerateRules(
    clusters: PatternCluster[],
    startRuleId: number
  ): Promise<GeneratedRule[]> {
    const results = await Promise.all(
      clusters.map(async (cluster, i) => {
        const ruleId = `rule-${String(startRuleId + i).padStart(3, "0")}`;
        try {
          const rule = await this.generateRule(cluster, ruleId);
          logger.info("llm-generation", `✓ Generated rule ${ruleId}: ${rule.title}`);
          return rule;
        } catch (error) {
          logger.error("llm-generation", `✗ Failed to generate rule for cluster ${cluster.cluster_id}`, error instanceof Error ? error : undefined);
          return null;
        }
      })
    );

    return results.filter((r): r is GeneratedRule => r !== null);
  }

  /**
   * Load labeled content for cluster.
   *
   * Loads the full content set for the cluster's pattern type ONCE and builds
   * an id -> content map, instead of re-querying the database for every single
   * content id (which was O(N^2) and scaled badly for large clusters).
   */
  private loadClusterContents(cluster: PatternCluster): LabeledContent[] {
    if (cluster.labeled_content_ids.length === 0) return [];

    const allContent = this.db.getLabeledContentByPatternType(cluster.pattern_type);
    const byId = new Map(allContent.map((c) => [c.id, c]));

    const contents: LabeledContent[] = [];
    for (const contentId of cluster.labeled_content_ids) {
      const content = byId.get(contentId);
      if (content) {
        contents.push(content);
      }
    }

    return contents;
  }


  /**
   * Parse LLM response
   */
  private parseRuleResponse(response: string): {
    title: string;
    description: string;
    rationale: string;
    scope: "global" | "organization" | "project";
    scope_confidence?: number;
    scope_reason?: string;
    how_to_apply: string[];
    examples?: { bad?: string; good: string; explanation: string };
    when_to_use: string[];
    exceptions?: string[];
    related_patterns?: string[];
    scenes?: Scene;  // Optional, fallback to extraction if not provided
  } {
    try {
      // Check for truncation first
      if (JSONExtractor.isTruncated(response)) {
        logger.warn("llm-generation", "Potentially truncated LLM response detected", {
          lastChars: response.slice(-100),
          length: response.length
        });
      }

      // Use robust JSON extraction with maximal matching
      const extraction = JSONExtractor.extract(response);

      if (!extraction.success || !extraction.parsed) {
        logger.error("llm-generation", "Failed to extract JSON from response", undefined, {
          error: extraction.error,
          responseSample: response.slice(0, 500)
        });
        throw new Error(`JSON extraction failed: ${extraction.error}`);
      }

      logger.debug("llm-generation", "JSON extracted successfully", {
        strategy: extraction.strategy
      });

      const parsed = extraction.parsed;

      // Validate required fields
      if (!parsed.title || !parsed.description || !parsed.rationale) {
        throw new Error("Missing required fields in LLM response");
      }

      // Validate and normalize scope field
      const validScopes = ["global", "organization", "project"];
      let scope: "global" | "organization" | "project";

      if (!parsed.scope) {
        logger.warn("llm-generation", "Missing scope field in LLM response, defaulting to 'global'");
        scope = "global";
      } else if (!validScopes.includes(parsed.scope)) {
        logger.warn("llm-generation", `Invalid scope value '${parsed.scope}', defaulting to 'global'`);
        scope = "global";
      } else {
        scope = parsed.scope as "global" | "organization" | "project";
      }

      // Ensure arrays exist
      if (!parsed.how_to_apply || !Array.isArray(parsed.how_to_apply)) {
        parsed.how_to_apply = [];
      }
      if (!parsed.when_to_use || !Array.isArray(parsed.when_to_use)) {
        parsed.when_to_use = [];
      }

      // Parse and normalize scenes
      let scenes: Scene | undefined;
      if (parsed.scenes) {
        // LLM might return partial scene data, normalize it
        scenes = createScene({
          tech: Array.isArray(parsed.scenes.tech) ? parsed.scenes.tech : [],
          functional: Array.isArray(parsed.scenes.functional) ? parsed.scenes.functional : [],
          business: Array.isArray(parsed.scenes.business) ? parsed.scenes.business : []
        });
      }

      return {
        title: parsed.title,
        description: parsed.description,
        rationale: parsed.rationale,
        scope: scope,
        scope_confidence: typeof parsed.scope_confidence === "number" ? parsed.scope_confidence : undefined,
        scope_reason: typeof parsed.scope_reason === "string" ? parsed.scope_reason : undefined,
        how_to_apply: parsed.how_to_apply,
        examples: parsed.examples,
        when_to_use: parsed.when_to_use,
        exceptions: parsed.exceptions,
        related_patterns: parsed.related_patterns,
        scenes: scenes
      };
    } catch (error) {
      logger.warn("llm-generation", "Failed to parse rule response", { error: error instanceof Error ? error.message : String(error), response: String(response) });
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
    if (cluster.pattern_type === PatternType.ANTI_PATTERN || cluster.pattern_type === PatternType.PERFORMANCE) {
      return "high";
    }

    // Corrections with high confidence and multiple occurrences are medium
    if (cluster.pattern_type === PatternType.REPEATED_CORRECTION) {
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
    rule: GeneratedRule,
    memorySupportScore?: number
  ): { indexEntry: RuleIndexEntry; content: RuleContent } {
    const indexEntry: RuleIndexEntry = {
      id: rule.id,
      // Preserve the original LLM-inferred pattern type instead of collapsing
      // everything into ANTI_PATTERN / REPEATED_CORRECTION (which broke
      // cross-type dedup and conflict detection).
      type: rule.patternType,
      priority: rule.priority as Priority,
      confidence: rule.confidence,
      scenes: {
        tech: rule.scenes.tech,
        functional: rule.scenes.functional,
        business: rule.scenes.business
      },
      keywords: rule.source_signals,
      created_at: rule.created_at,
      updated_at: rule.last_validated,
      scope: rule.scope as RuleScope,  // Convert scope string to RuleScope enum
      scope_confidence: rule.scope_confidence || 0.5,
      scope_reason: rule.scope_reason,
      description: rule.description
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
        source_sessions: rule.source_sessions,
        source_memory_ids: rule.source_memory_ids,
        scope_confidence: rule.scope_confidence || 0.5,
        scope_reason: rule.scope_reason
      }
    };

    // Memory-support score: driven by the real promoted memories backing this
    // rule (resolved from source_memory_ids) instead of the evidence-count
    // heuristic. Falls back to the heuristic only when no memory store is
    // reachable.
    const repo = this.getMemoryRepo();
    const support = memorySupportScore !== undefined
      ? { ids: rule.source_memory_ids ?? [], score: memorySupportScore }
      : repo
        ? resolveMemorySupport(repo, rule.source_memory_ids)
        : { ids: rule.source_memory_ids ?? [], score: deriveMemorySupportScore(rule.evidence_count, rule.scope_confidence || 0.5) };

    indexEntry.source_memory_ids = support.ids;
    content.metadata.source_memory_ids = support.ids;
    content.metadata.memory_support_score = support.score;

    const unified = new RuleQualityController().assessUnifiedScore(
      content,
      indexEntry,
      rule.confidence,
      rule.scope_confidence || 0.5,
      support.score
    );
    indexEntry.confidence = unified.overall;
    content.metadata.quality_score = unified.overall;
    content.metadata.evidence_confidence = unified.evidence_confidence;
    content.metadata.confidence = unified.overall;

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
    if (rule.scenes.tech.length === 0 && rule.scenes.functional.length === 0 && rule.scenes.business.length === 0) {
      issues.push("Rule should have at least one scene dimension (tech, functional, or business)");
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

  /**
   * Extract scenes from cluster content (fallback when LLM doesn't provide)
   */
  private extractScenesFromCluster(cluster: PatternCluster, contents: LabeledContent[]): Scene {
    const sceneExtractor = SceneExtractor.getInstance();

    const combinedText = [
      cluster.representative_description || '',
      ...cluster.common_signals,
      ...contents.map(c => c.content)
    ].join(' ');

    return sceneExtractor.extractScene({
      text: combinedText,
      keywords: cluster.common_signals
    });
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

  close() {
    this.db.close();
  }
}

/**
 * Derive a memory-support score from observable evidence when a caller does
 * not supply a real memory-derived score.
 *
 * Replaces the previous hard-coded constant 0.5 so the `memory` dimension of
 * the unified score actually varies: more corroborating occurrences and a
 * higher scope confidence yield a stronger memory-support signal. Callers that
 * have access to promoted-memory data should pass it explicitly via the
 * `memorySupportScore` parameter instead.
 */
function deriveMemorySupportScore(evidenceCount: number, scopeConfidence: number): number {
  const evidence = Math.min(1, (evidenceCount || 0) / 5); // 5+ occurrences -> 1.0
  const scope = Math.max(0, Math.min(1, scopeConfidence));
  const score = 0.3 + 0.4 * evidence + 0.3 * scope;
  return Math.max(0, Math.min(1, score));
}
