/**
 * Batch LLM Rule Generator
 *
 * Optimized batch processing strategy:
 * 1. Group similar patterns into clusters
 * 2. Send clusters to LLM in batches (one LLM call per cluster)
 * 3. LLM analyzes, merges duplicates, and generates optimized rules
 * 4. Return deduplicated, high-quality rules
 *
 * Benefits:
 * - Reduced LLM calls (N patterns → M clusters, M << N)
 * - LLM-driven deduplication (smarter than rule-based)
 * - Better context for LLM (sees related patterns together)
 */

import Anthropic from "@anthropic-ai/sdk";
import { Pattern, RuleIndexEntry, RuleContent, Scene, Priority } from "./models.js";
import { PatternSimilarityClusterer, PatternClusterGroup } from "./pattern-similarity-clusterer.js";
import { RuleGenerator } from "./rule-generator.js";
import { logger } from "./logger.js";
import { LLMPromptBuilder, PromptEvidence } from "./llm-prompt-builder.js";
import { appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const LLM_LOG_FILE = join(homedir(), ".autoimprove", "llm-calls.log");

export interface BatchLLMOptions {
  /** Minimum similarity for clustering (0-1) */
  minSimilarity?: number;

  /** Maximum patterns per LLM request */
  maxPatternsPerBatch?: number;

  /** Minimum patterns to form a cluster */
  minClusterSize?: number;

  /** Enable parallel LLM requests */
  enableParallel?: boolean;

  /** Maximum concurrent LLM requests */
  maxConcurrent?: number;
}

export interface BatchGeneratedRule {
  indexEntry: RuleIndexEntry;
  content: RuleContent;
  source_patterns: string[];  // Pattern descriptions that contributed
  dedup_count: number;  // How many similar patterns were merged
}

export class BatchLLMRuleGenerator {
  private clusterer: PatternSimilarityClusterer;
  private basicGenerator: RuleGenerator;
  private anthropic: Anthropic | null;

  constructor() {
    this.clusterer = new PatternSimilarityClusterer();
    this.basicGenerator = new RuleGenerator();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    } else {
      this.anthropic = null;
    }
  }

  /**
   * Batch generate rules with intelligent clustering and LLM merging
   */
  async batchGenerateRules(
    patterns: Pattern[],
    startId: number,
    scene?: Scene,
    options: BatchLLMOptions = {}
  ): Promise<BatchGeneratedRule[]> {
    const {
      minSimilarity = 0.4,
      maxPatternsPerBatch = 8,
      minClusterSize = 2,
      enableParallel = true,
      maxConcurrent = 3
    } = options;

    logger.info("batch-llm", `\n=== Batch LLM Rule Generation ===`);
    logger.info("batch-llm", `Total patterns: ${patterns.length}`);

    // Step 1: Cluster similar patterns
    logger.info("batch-llm", `\n[1/3] Clustering similar patterns...`);
    const clusters = this.clusterer.clusterPatterns(patterns, {
      minSimilarity,
      maxClusterSize: maxPatternsPerBatch,
      minClusterSize
    });

    const stats = this.clusterer.getClusteringStats(clusters);
    logger.info("batch-llm", `✓ Created ${stats.total_clusters} clusters:`);
    logger.info("batch-llm", `  - Multi-pattern: ${stats.multi_pattern_clusters} (will merge)`);
    logger.info("batch-llm", `  - Singleton: ${stats.singleton_clusters} (unique patterns)`);
    logger.info("batch-llm", `  - Largest cluster: ${stats.largest_cluster_size} patterns`);
    logger.info("batch-llm", `  - Avg cluster size: ${stats.avg_cluster_size.toFixed(1)}`);
    logger.info("batch-llm", `  - Reduction: ${patterns.length} → ${clusters.length} LLM calls (${((1 - clusters.length / patterns.length) * 100).toFixed(1)}% fewer)`);

    // Step 2: Generate rules from clusters (with LLM merging)
    logger.info("batch-llm", `\n[2/3] Generating rules from clusters...`);

    const allRules: BatchGeneratedRule[] = [];
    let currentId = startId;

    if (enableParallel && this.anthropic) {
      // Parallel processing with concurrency limit
      allRules.push(...await this.processClustersConcurrently(
        clusters,
        currentId,
        scene,
        maxConcurrent
      ));
    } else {
      // Sequential processing
      for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i];
        const ruleId = `rule-${String(currentId++).padStart(3, "0")}`;

        try {
          const rules = await this.processCluster(cluster, ruleId, scene);
          allRules.push(...rules);

          const mergeInfo = cluster.patterns.length > 1
            ? ` (merged ${cluster.patterns.length} patterns)`
            : "";
          logger.info("batch-llm", `  [${i + 1}/${clusters.length}] ✓ ${rules.length} rule(s) from cluster${mergeInfo}`);
        } catch (error) {
          logger.error("batch-llm", `  [${i + 1}/${clusters.length}] ✗ Failed`, error instanceof Error ? error : undefined);
        }
      }
    }

    // Step 3: Summary
    logger.info("batch-llm", `\n[3/3] Summary:`);
    logger.info("batch-llm", `✓ Generated ${allRules.length} rules from ${clusters.length} clusters`);

    const totalDeduplicated = allRules.reduce((sum, r) => sum + r.dedup_count, 0);
    if (totalDeduplicated > 0) {
      logger.info("batch-llm", `  - Deduplicated: ${totalDeduplicated} patterns merged into rules`);
    }

    return allRules;
  }

  /**
   * Process clusters with concurrency control
   */
  private async processClustersConcurrently(
    clusters: PatternClusterGroup[],
    startId: number,
    scene?: Scene,
    maxConcurrent: number = 3
  ): Promise<BatchGeneratedRule[]> {
    const allRules: BatchGeneratedRule[] = [];
    const queue = [...clusters];
    let currentId = startId;
    let processed = 0;

    // Process in batches
    while (queue.length > 0) {
      const batch = queue.splice(0, maxConcurrent);
      const promises = batch.map((cluster, idx) => {
        const ruleId = `rule-${String(currentId + idx).padStart(3, "0")}`;
        return this.processCluster(cluster, ruleId, scene)
          .then(rules => ({ success: true, rules, cluster }))
          .catch(error => ({ success: false, error, cluster }));
      });

      const results = await Promise.all(promises);

      for (const result of results) {
        processed++;
        if (result.success && 'rules' in result) {
          allRules.push(...result.rules);
          const mergeInfo = result.cluster.patterns.length > 1
            ? ` (merged ${result.cluster.patterns.length})`
            : "";
          logger.info("batch-llm", `  [${processed}/${clusters.length}] ✓ ${result.rules.length} rule(s)${mergeInfo}`);
        } else if ('error' in result) {
          logger.error("batch-llm", `  [${processed}/${clusters.length}] ✗ Failed:`, result.error);
        }
      }

      currentId += batch.length;
    }

    return allRules;
  }

  /**
   * Process a single cluster (1 LLM call, may return multiple rules if diverse)
   */
  private async processCluster(
    cluster: PatternClusterGroup,
    ruleId: string,
    scene?: Scene
  ): Promise<BatchGeneratedRule[]> {
    if (!this.anthropic) {
      // Fallback: generate basic rules without LLM
      return cluster.patterns.map((p, idx) => {
        const id = idx === 0 ? ruleId : `${ruleId}-${idx}`;
        const basic = this.basicGenerator.generateRule(p, id, scene);
        return {
          indexEntry: basic.indexEntry,
          content: basic.content,
          source_patterns: [p.description],
          dedup_count: 0
        };
      });
    }

    // Check if patterns should be generated
    const qualifiedPatterns = cluster.patterns.filter(p => {
      const { shouldGenerate } = this.basicGenerator["classifier"].shouldGenerateRule(p);
      return shouldGenerate;
    });

    if (qualifiedPatterns.length === 0) {
      return [];
    }

    // Build unified prompt using LLMPromptBuilder
    const evidence: PromptEvidence[] = qualifiedPatterns.map(p =>
      LLMPromptBuilder.patternToEvidence(p)
    );

    const prompt = LLMPromptBuilder.buildPrompt(evidence, {
      patternType: cluster.pattern_type,
      avgConfidence: cluster.avg_confidence,
      commonKeywords: cluster.common_keywords,
      totalOccurrences: cluster.total_occurrences,
      sessionCount: cluster.session_count,
      isBatchMode: true,
      maxContentExamples: 5
    });

    const maxTokens = this.calculateMaxTokens(cluster);

    // Use environment variable for model configuration
    const model = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
      || process.env.ANTHROPIC_MODEL
      || "claude-sonnet-4-6";

    const requestLog = `\n${"=".repeat(80)}\n` +
      `[${new Date().toISOString()}] [BATCH-LLM REQUEST] Cluster ${cluster.cluster_id}\n` +
      `${"=".repeat(80)}\n` +
      `Patterns: ${cluster.patterns.length}, Type: ${cluster.pattern_type}\n` +
      `Model: ${model}, Max tokens: ${maxTokens}\n` +
      `Prompt length: ${prompt.length} chars\n` +
      `${"-".repeat(80)}\n` +
      `FULL PROMPT:\n${prompt}\n` +
      `${"-".repeat(80)}\n`;

    logger.debug("batch-llm", "LLM request sent", { cluster_id: cluster.cluster_id, prompt_length: prompt.length });
    appendFileSync(LLM_LOG_FILE, requestLog, "utf8");

    try {
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{
          role: "user",
          content: prompt
        }]
      });

      const responseText = response.content[0].type === "text" ? response.content[0].text : "";

      const responseLog = `\n${"=".repeat(80)}\n` +
        `[${new Date().toISOString()}] [BATCH-LLM RESPONSE] Cluster ${cluster.cluster_id}\n` +
        `${"=".repeat(80)}\n` +
        `Response length: ${responseText.length} chars\n` +
        `Stop reason: ${response.stop_reason}\n` +
        `Usage: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}\n` +
        `${"-".repeat(80)}\n` +
        `FULL RESPONSE:\n${responseText}\n` +
        `${"-".repeat(80)}\n\n`;

      logger.debug("batch-llm", "LLM response received", {
        cluster_id: cluster.cluster_id,
        response_length: responseText.length,
        stop_reason: response.stop_reason,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens
      });
      appendFileSync(LLM_LOG_FILE, responseLog, "utf8");

      // Parse response (may contain multiple rules)
      const parsedRules = this.parseBatchResponse(responseText, cluster);

      // Convert to storage format
      const rules: BatchGeneratedRule[] = [];
      for (let i = 0; i < parsedRules.length; i++) {
        const parsed = parsedRules[i];
        const id = i === 0 ? ruleId : `${ruleId}-${String.fromCharCode(97 + i)}`;  // rule-001, rule-001-a, etc.

        const { indexEntry, content } = this.convertToStorageFormat(parsed, id, cluster, scene);

        rules.push({
          indexEntry,
          content,
          source_patterns: parsed.source_patterns,
          dedup_count: parsed.merged_count
        });
      }

      return rules;
    } catch (error) {
      logger.warn("batch-llm", `LLM batch processing failed for cluster ${cluster.cluster_id}`, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }


  /**
   * Parse batch LLM response (may contain multiple rules)
   */
  private parseBatchResponse(response: string, cluster: PatternClusterGroup): Array<{
    title: string;
    description: string;
    rationale: string;
    how_to_apply: string[];
    when_to_use: string[];
    exceptions?: string[];
    source_patterns: string[];
    merged_count: number;
  }> {
    try {
      // Extract JSON from markdown code block if present
      let jsonStr = response.trim();
      const jsonMatch = jsonStr.match(/```json\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      // Check for response completeness before parsing
      const trimmed = jsonStr.trim();
      if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
        logger.warn("batch-llm", "Potentially truncated LLM response detected", {
          lastChars: trimmed.slice(-100),
          length: trimmed.length
        });
      }

      // Sanitize control characters and unescaped quotes in JSON strings
      // This handles unescaped newlines, tabs, nested quotes (Python docstrings), etc.
      jsonStr = this.sanitizeJson(jsonStr);

      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch (parseError) {
        // Attempt recovery strategies
        logger.warn("batch-llm", "Initial parse failed, attempting recovery", {
          error: parseError instanceof Error ? parseError.message : String(parseError)
        });

        // Strategy 1: Try to extract partial valid JSON up to the error position
        const errorMatch = parseError instanceof Error
          ? parseError.message.match(/position (\d+)/)
          : null;

        if (errorMatch) {
          const errorPos = parseInt(errorMatch[1]);
          const partialJson = this.attemptPartialRecovery(jsonStr, errorPos);

          if (partialJson) {
            try {
              parsed = JSON.parse(partialJson);
              logger.info("batch-llm", "Successfully recovered partial JSON");
            } catch {
              // Recovery failed, continue to next strategy
            }
          }
        }

        // Strategy 2: Try removing incomplete last object/array element
        if (!parsed) {
          const recoveredJson = this.attemptIncompleteElementRemoval(jsonStr);
          if (recoveredJson) {
            try {
              parsed = JSON.parse(recoveredJson);
              logger.info("batch-llm", "Successfully recovered by removing incomplete element");
            } catch {
              // Recovery failed
            }
          }
        }

        // If all recovery failed, log details and throw
        if (!parsed) {
          logger.error("batch-llm", "All recovery strategies failed", parseError instanceof Error ? parseError : undefined, {
            jsonSample: jsonStr.slice(0, 500),
            jsonEnd: jsonStr.slice(-500)
          });
          throw parseError;
        }
      }

      // Normalize to array
      const rulesArray = Array.isArray(parsed) ? parsed : [parsed];

      // Validate and normalize each rule
      return rulesArray.map(rule => {
        if (!rule.title || !rule.description || !rule.rationale) {
          throw new Error("Missing required fields in LLM response");
        }

        return {
          title: rule.title,
          description: rule.description,
          rationale: rule.rationale,
          how_to_apply: rule.how_to_apply || [],
          when_to_use: rule.when_to_use || [],
          exceptions: rule.exceptions,
          source_patterns: rule.source_patterns || [cluster.representative_description],
          merged_count: rule.merged_count || 1
        };
      });
    } catch (error) {
      logger.error("batch-llm", "Failed to parse batch LLM response", error instanceof Error ? error : undefined, {
        responseLength: response.length,
        responseSample: response.slice(0, 300)
      });
      throw error;
    }
  }

  /**
   * Sanitize JSON string to fix common LLM output issues
   * Note: Only remove control characters, don't try to fix string escaping
   * as that can break valid formatted JSON
   */
  private sanitizeJson(jsonStr: string): string {
    // Only remove problematic control characters (NULL, etc.)
    // Don't touch newlines, tabs, or other whitespace - they're valid in JSON structure
    return jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Attempt to recover partial valid JSON by finding last complete object
   */
  private attemptPartialRecovery(jsonStr: string, errorPos: number): string | null {
    // Find the last complete object before error position
    const beforeError = jsonStr.slice(0, errorPos);

    // Try to find last complete object by counting braces
    let depth = 0;
    let lastCompletePos = -1;

    for (let i = 0; i < beforeError.length; i++) {
      const char = beforeError[i];
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          lastCompletePos = i;
        }
      }
    }

    if (lastCompletePos > 0) {
      // Extract up to last complete object and close array if needed
      let recovered = beforeError.slice(0, lastCompletePos + 1);

      // If it starts with [, ensure it ends with ]
      if (recovered.trim().startsWith('[') && !recovered.trim().endsWith(']')) {
        recovered += ']';
      }

      return recovered;
    }

    return null;
  }

  /**
   * Attempt to remove incomplete last element from array
   */
  private attemptIncompleteElementRemoval(jsonStr: string): string | null {
    // If it's an array, try to find and remove the last incomplete element
    const trimmed = jsonStr.trim();

    if (!trimmed.startsWith('[')) {
      return null;
    }

    // Find last comma at depth 1
    let depth = 0;
    let lastCommaPos = -1;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];
      if (char === '{' || char === '[') depth++;
      if (char === '}' || char === ']') depth--;
      if (char === ',' && depth === 1) {
        lastCommaPos = i;
      }
    }

    if (lastCommaPos > 0) {
      // Remove everything after last comma and close array
      return trimmed.slice(0, lastCommaPos) + '\n]';
    }

    return null;
  }

  /**
   * Convert parsed rule to storage format
   */
  private convertToStorageFormat(
    parsed: any,
    ruleId: string,
    cluster: PatternClusterGroup,
    scene?: Scene
  ): { indexEntry: RuleIndexEntry; content: RuleContent } {
    // Use first pattern for metadata
    const firstPattern = cluster.patterns[0];

    // Build formatted content
    let formattedContent = `# ${parsed.title}\n\n`;
    formattedContent += `## Description\n\n${parsed.description}\n\n`;
    formattedContent += `## Rationale\n\n${parsed.rationale}\n\n`;

    if (parsed.how_to_apply?.length > 0) {
      formattedContent += `## How to Apply\n\n`;
      for (const step of parsed.how_to_apply) {
        formattedContent += `- ${step}\n`;
      }
      formattedContent += `\n`;
    }

    if (parsed.when_to_use?.length > 0) {
      formattedContent += `## When to Use\n\n`;
      for (const condition of parsed.when_to_use) {
        formattedContent += `- ${condition}\n`;
      }
      formattedContent += `\n`;
    }

    if (parsed.exceptions?.length > 0) {
      formattedContent += `## Exceptions\n\n`;
      for (const exception of parsed.exceptions) {
        formattedContent += `- ${exception}\n`;
      }
      formattedContent += `\n`;
    }

    const indexEntry: RuleIndexEntry = {
      id: ruleId,
      type: firstPattern.type,
      priority: this.determinePriority(cluster),
      confidence: cluster.avg_confidence,
      scenes: scene || { tech: [], functional: [], business: [] },
      keywords: cluster.common_keywords,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const content: RuleContent = {
      id: ruleId,
      content: formattedContent,
      title: parsed.title,
      description: parsed.description,
      reason: parsed.rationale,
      how_to_apply: parsed.how_to_apply,
      when_to_use: parsed.when_to_use,
      exceptions: parsed.exceptions,
      metadata: {
        type: firstPattern.type,
        priority: indexEntry.priority,
        confidence: cluster.avg_confidence,
        source: "batch_llm_learned",
        pattern_occurrences: cluster.total_occurrences,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        keywords: cluster.common_keywords,
        source_patterns: parsed.source_patterns,
        merged_pattern_count: parsed.merged_count
      }
    };

    return { indexEntry, content };
  }

  /**
   * Determine rule priority
   */
  private determinePriority(cluster: PatternClusterGroup): Priority {
    if (cluster.pattern_type === "security") return Priority.CRITICAL;
    if (cluster.pattern_type === "anti-pattern") return Priority.HIGH;
    if (cluster.pattern_type === "performance") return Priority.HIGH;
    if (cluster.avg_confidence >= 0.8 && cluster.total_occurrences >= 5) return Priority.MEDIUM;
    return Priority.LOW;
  }

  /**
   * Calculate max tokens based on cluster complexity
   */
  private calculateMaxTokens(cluster: PatternClusterGroup): number {
    const baseTokens = 1500;  // Increased from 1000 to reduce truncation
    const perPatternTokens = 250;  // Increased from 200 for code examples

    // More tokens for complex clusters
    const complexity = cluster.patterns.length * perPatternTokens;

    // Security needs more explanation
    const typeBonus = cluster.pattern_type === "security" ? 500 : 0;

    // Higher ceiling to accommodate code examples
    return Math.min(3000, baseTokens + complexity + typeBonus);
  }
}
