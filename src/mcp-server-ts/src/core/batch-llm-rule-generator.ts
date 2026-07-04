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

    // console.error(`\n=== Batch LLM Rule Generation ===`);
    // console.error(`Total patterns: ${patterns.length}`);

    // Step 1: Cluster similar patterns
    // console.error(`\n[1/3] Clustering similar patterns...`);
    const clusters = this.clusterer.clusterPatterns(patterns, {
      minSimilarity,
      maxClusterSize: maxPatternsPerBatch,
      minClusterSize
    });

    const stats = this.clusterer.getClusteringStats(clusters);
    // console.error(`✓ Created ${stats.total_clusters} clusters:`);
    // console.error(`  - Multi-pattern: ${stats.multi_pattern_clusters} (will merge)`);
    // console.error(`  - Singleton: ${stats.singleton_clusters} (unique patterns)`);
    // console.error(`  - Largest cluster: ${stats.largest_cluster_size} patterns`);
    // console.error(`  - Avg cluster size: ${stats.avg_cluster_size.toFixed(1)}`);
    // console.error(`  - Reduction: ${patterns.length} → ${clusters.length} LLM calls (${((1 - clusters.length / patterns.length) * 100).toFixed(1)}% fewer)`);

    // Step 2: Generate rules from clusters (with LLM merging)
    // console.error(`\n[2/3] Generating rules from clusters...`);

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
          // console.error(`  [${i + 1}/${clusters.length}] ✓ ${rules.length} rule(s) from cluster${mergeInfo}`);
        } catch (error) {
          // console.error(`  [${i + 1}/${clusters.length}] ✗ Failed:`, error);
        }
      }
    }

    // Step 3: Summary
    // console.error(`\n[3/3] Summary:`);
    // console.error(`✓ Generated ${allRules.length} rules from ${clusters.length} clusters`);

    const totalDeduplicated = allRules.reduce((sum, r) => sum + r.dedup_count, 0);
    if (totalDeduplicated > 0) {
      // console.error(`  - Deduplicated: ${totalDeduplicated} patterns merged into rules`);
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
          // console.error(`  [${processed}/${clusters.length}] ✓ ${result.rules.length} rule(s)${mergeInfo}`);
        } else if ('error' in result) {
          // console.error(`  [${processed}/${clusters.length}] ✗ Failed:`, result.error);
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

    // Build batch prompt
    const prompt = this.buildBatchPrompt(cluster, qualifiedPatterns);
    const maxTokens = this.calculateMaxTokens(cluster);

    // Use environment variable for model configuration
    const model = process.env.ANTHROPIC_DEFAULT_SONNET_MODEL
      || process.env.ANTHROPIC_MODEL
      || "claude-sonnet-4-6";

    const requestLog = `\n[${new Date().toISOString()}] [BATCH-LLM] Processing cluster ${cluster.cluster_id}\n` +
      `Patterns: ${cluster.patterns.length}, Type: ${cluster.pattern_type}\n` +
      `Model: ${model}, Max tokens: ${maxTokens}\n` +
      `Prompt (${prompt.length} chars):\n${prompt.slice(0, 500)}...\n`;

    // console.error(requestLog);
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

      const responseLog = `[${new Date().toISOString()}] [BATCH-LLM] Response (${responseText.length} chars):\n${responseText.slice(0, 500)}...\n`;
      // console.error(responseLog);
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
      // console.error(`LLM batch processing failed for cluster ${cluster.cluster_id}:`, error);
      throw error;
    }
  }

  /**
   * Build batch prompt for LLM (with merge instructions)
   */
  private buildBatchPrompt(cluster: PatternClusterGroup, patterns: Pattern[]): string {
    // Format patterns with context
    const patternDescriptions = patterns.map((p, i) => {
      const occCount = p.occurrences.length;
      const confidence = (p.confidence * 100).toFixed(0);
      const keywords = p.keywords.slice(0, 5).join(", ");

      // Get representative user input
      const userInputs = p.occurrences
        .map(o => o.user_input)
        .filter(input => input && input.length > 20)
        .slice(0, 2);

      let desc = `${i + 1}. "${p.description}"\n`;
      desc += `   Confidence: ${confidence}%, Occurrences: ${occCount}, Keywords: ${keywords}\n`;

      if (userInputs.length > 0) {
        desc += `   Evidence: ${userInputs.join(" | ")}`;
      }

      return desc;
    }).join("\n\n");

    const isSinglePattern = patterns.length === 1;

    return `${isSinglePattern ? 'Generate' : 'Analyze and merge'} coding rule${isSinglePattern ? '' : 's'} from pattern${isSinglePattern ? '' : 's'}.

Type: ${cluster.pattern_type} | Avg confidence: ${(cluster.avg_confidence * 100).toFixed(0)}%
Common keywords: ${cluster.common_keywords.join(", ")}

Patterns (${patterns.length}):
${patternDescriptions}

${isSinglePattern ? 'Generate 1 rule.' : `Instructions:
1. Identify if patterns describe the SAME rule or DIFFERENT rules
2. MERGE similar/duplicate patterns into ONE rule
3. Keep distinct patterns as SEPARATE rules
4. For merged rules, list source_patterns and merged_count`}

Output JSON array: [{"title":"...","description":"...","rationale":"...","how_to_apply":[...],"when_to_use":[...],"exceptions":[...],"examples":{"bad":"...","good":"...","explanation":"..."},"source_patterns":["pattern 1","pattern 2"],"merged_count":2}]

${isSinglePattern ? '' : 'If all patterns are similar, return 1 rule. If distinct, return multiple rules.'}

Rules:
- title: imperative verb, 60-80 chars
- description: what to do/avoid, 3-5 sentences, specific
- rationale: why (2-4 sentences, concrete benefits/risks)
- how_to_apply: 3-6 actionable steps (array)
- when_to_use: 3-5 conditions (array)
- exceptions: 2-4 edge cases (array, optional)
- examples: {bad?, good, explanation} - realistic code (optional)
- source_patterns: original pattern descriptions merged (array)
- merged_count: number of patterns merged into this rule

Be specific, actionable, deduplicate aggressively.`;
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
    examples?: { bad?: string; good: string; explanation: string };
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

      const parsed = JSON.parse(jsonStr);

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
          examples: rule.examples,
          source_patterns: rule.source_patterns || [cluster.representative_description],
          merged_count: rule.merged_count || 1
        };
      });
    } catch (error) {
      // console.error("Failed to parse batch LLM response:", error);
      // console.error("Response was:", response);
      throw error;
    }
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

    if (parsed.examples) {
      formattedContent += `## Examples\n\n`;
      if (parsed.examples.bad) {
        formattedContent += `### ❌ Avoid\n\n\`\`\`typescript\n${parsed.examples.bad}\n\`\`\`\n\n`;
      }
      formattedContent += `### ✅ Prefer\n\n\`\`\`typescript\n${parsed.examples.good}\n\`\`\`\n\n`;
      formattedContent += `**Why**: ${parsed.examples.explanation}\n\n`;
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
      examples: parsed.examples ? [{
        bad: parsed.examples.bad,
        good: parsed.examples.good,
        explanation: parsed.examples.explanation,
        language: "typescript"
      }] : undefined,
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
    const baseTokens = 1000;
    const perPatternTokens = 200;

    // More tokens for complex clusters
    const complexity = cluster.patterns.length * perPatternTokens;

    // Security needs more explanation
    const typeBonus = cluster.pattern_type === "security" ? 500 : 0;

    return Math.min(2000, baseTokens + complexity + typeBonus);
  }
}
