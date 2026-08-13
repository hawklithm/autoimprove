/**
 * Batch Rebuild Engine for AutoImprove
 *
 * Implements incremental rebuild with caching:
 * 1. Discover all session files
 * 2. Check cache for each session (SHA256 hash)
 * 3. Analyze only changed sessions
 * 4. Merge cached + new patterns
 * 5. Track pattern evolution
 * 6. Generate rules with enhanced confidence
 * 7. Export to Claude index
 */

import { readdirSync, statSync } from "fs";
import { join } from "path";
import { SessionAnalyzer } from "./session-analyzer.js";
import { UnifiedSessionParser } from "./unified-session-parser.js";
import { SessionCacheManager } from "../storage/session-cache.js";
import { PatternEvolutionManager } from "../storage/pattern-evolution.js";
import { HybridRuleGenerator, EnhancedRuleOptions } from "./hybrid-rule-generator.js";
import { BatchLLMRuleGenerator, BatchLLMOptions } from "./batch-llm-rule-generator.js";
import { RuleIndexManager } from "../storage/rule-index.js";
import { RuleContentManager } from "../storage/rule-content.js";
import { ClaudeIndexExporter } from "../tools/export-rules-to-claude.js";
import { Pattern, Scene, RuleIndexEntry, RuleContent } from "./models.js";
import { RuleCleanupService, CleanupReport } from "./rule-cleanup-service.js";
import { UNIFIED_RULE_MIN_SCORE } from "./rule-quality.js";
import { logger } from "./logger.js";
import { homedir } from "os";
import { RuleDeduplicator } from "./rule-deduplicator.js";
import { MemoryRepository, MemoryRecord } from "./memory-models.js";
import { createDefaultMemoryRepository } from "../storage/memory-sqlite-store.js";
import { RuleQualityController } from "./rule-quality.js";
import { MemoryPromotionService } from "./memory-promotion.js";
import { MemoryRuleAdapter } from "./memory-rule-adapter.js";
import { EmbeddingEncoder } from "./embedding-encoder.js";
import { findRelevantMemoryIds, resolveMemorySupport, FALLBACK_MEMORY_SUPPORT } from "./memory-support.js";
import { filterNoisePatterns, generalityDiscount } from "./pattern-noise-filter.js";
import { RuleClassifier } from "./classifier.js";

/**
 * Default quality floor for the rebuild rule-generation gate (P2-D).
 * Lowered from the historical 0.6 so sparse / single-session sessions still
 * produce rules — when a pattern is below this floor we defer to the per-type
 * classifier graded gate (e.g. a single PREFERENCE at conf >= 0.3), instead of
 * silently yielding 0 rules.
 */
export const DEFAULT_REBUILD_MIN_CONFIDENCE = 0.3;

export interface BatchRebuildOptions {
  /** Clear all caches before rebuild */
  force?: boolean;

  /** Use cached results (default: true) */
  incremental?: boolean;

  /** Minimum confidence threshold (default: 0.6) */
  minConfidence?: number;

  /** Maximum sessions to process (for testing) */
  sessionLimit?: number;

  /** Preview without writing rules */
  dryRun?: boolean;

  /** Session directory to scan */
  sessionDir?: string;

  /** Enhanced rule generation options */
  enhancedRuleOptions?: EnhancedRuleOptions;

  /** Use batch LLM optimization (clustering + merging, default: true) */
  useBatchLLM?: boolean;

  /** Batch LLM options */
  batchLLMOptions?: BatchLLMOptions;

  /** Auto-cleanup rules after generation (default: true) */
  autoCleanup?: boolean;

  /** Merge duplicate/similar rules during cleanup (default: true) */
  mergeDuplicates?: boolean;

  /** Optimize low-quality rules during cleanup (default: true) */
  optimizeLowQuality?: boolean;

  /** Delete very low quality rules during cleanup (default: false) */
  deleteVeryLowQuality?: boolean;

  /** Quality threshold for deletion (default: 0.3) */
  veryLowQualityThreshold?: number;

  /** Force cleanup even if batch LLM was used (default: false) */
  forceCleanup?: boolean;
}

export interface BatchRebuildResult {
  sessions_analyzed: number;
  sessions_cached: number;
  patterns_total: number;
  patterns_qualified: number;
  rules_generated: number;
  rules_exported: number;
  cache_hit_rate: number;
  execution_time_ms: number;
  cleanup_performed?: boolean;
  rules_merged?: number;
  rules_optimized?: number;
  rules_deleted?: number;
}

/**
 * P2-D (defect D): decide whether a pattern is a candidate for rule generation.
 *
 * The global `minConfidence` is treated as a *quality floor*, not a sole gate.
 * When a pattern falls below the global floor we still defer to the per-type
 * `RuleClassifier` graded gate — otherwise a strict global default (e.g. 0.6)
 * silently zeroes out sparse / single-session sessions even though the
 * classifier would accept a single PREFERENCE at conf >= 0.3. This is what made
 * the default 0.6 produce 0 rules on a handful of independent sessions.
 */
export function isPatternQualifiedForRules(
  pattern: Pattern,
  minConfidence: number,
  classifier: RuleClassifier
): boolean {
  // Apply the P1-C2 generality discount to the effective confidence.
  const effective = pattern.confidence * generalityDiscount(pattern);
  if (effective >= minConfidence) return true;
  // Defer to the per-type classifier graded gate as a fallback.
  return classifier.shouldGenerateRule(pattern).shouldGenerate;
}

export class BatchRebuildEngine {
  private analyzer!: SessionAnalyzer;
  private parser: UnifiedSessionParser;
  private cacheManager: SessionCacheManager;
  private evolutionManager: PatternEvolutionManager;
  private ruleGenerator: HybridRuleGenerator;
  private batchLLMGenerator: BatchLLMRuleGenerator;
  private indexManager: RuleIndexManager;
  private contentManager: RuleContentManager;
  private exporter: ClaudeIndexExporter;
  private cleanupService: RuleCleanupService;
  private deduplicator: RuleDeduplicator;
  private memoryStore: MemoryRepository;
  private qualityController: RuleQualityController;
  private memoryPromotion: MemoryPromotionService;

  constructor() {
    this.parser = new UnifiedSessionParser();
    this.cacheManager = new SessionCacheManager();
    this.evolutionManager = new PatternEvolutionManager();
    this.ruleGenerator = new HybridRuleGenerator();
    this.indexManager = new RuleIndexManager();
    this.contentManager = new RuleContentManager();
    this.exporter = new ClaudeIndexExporter(this.indexManager, this.contentManager);
    this.cleanupService = new RuleCleanupService();
    this.deduplicator = new RuleDeduplicator();
    this.memoryStore = createDefaultMemoryRepository();
    // Construct the analyzer with the SAME memory repository so memories
    // written during analysis (Step 4) are visible to the rule-generation
    // memory-support pass (Step 7) — critical when the JSONL backend keeps
    // an in-memory Map that is not shared across instances.
    this.analyzer = new SessionAnalyzer(this.memoryStore);
    this.qualityController = new RuleQualityController();
    this.memoryPromotion = new MemoryPromotionService(this.memoryStore);
    // Construct after memoryStore so the generator can reuse the same repository.
    this.batchLLMGenerator = new BatchLLMRuleGenerator(this.memoryStore);
  }

  /**
   * Execute batch rebuild
   */
  async rebuild(options: BatchRebuildOptions = {}): Promise<BatchRebuildResult> {
    const startTime = Date.now();

    const {
      force = false,
      incremental = true,
      minConfidence = DEFAULT_REBUILD_MIN_CONFIDENCE,
      sessionLimit,
      dryRun = false,
      sessionDir = join(homedir(), ".claude", "projects"),
      enhancedRuleOptions = {},
    } = options;

    logger.info("batch-rebuild", "=== AutoImprove Batch Rebuild ===");
    logger.debug("batch-rebuild", `Mode: ${force ? "FORCE (clear cache)" : incremental ? "INCREMENTAL" : "FULL"}`);
    logger.debug("batch-rebuild", `Min confidence: ${minConfidence}`);
    logger.debug("batch-rebuild", `Dry run: ${dryRun}`);

    // Step 1: Clear caches if force mode
    if (force) {
      logger.info("batch-rebuild", "\n[1/7] Clearing caches...");
      this.cacheManager.clearAll();
      logger.info("batch-rebuild", "✓ Cache cleared");
    }

    // Step 2: Discover all session files
    logger.info("batch-rebuild", "\n[2/7] Discovering session files...");
    const allSessionFiles = this.discoverSessionFiles(sessionDir);
    logger.info("batch-rebuild", `✓ Found ${allSessionFiles.length} session files`);

    const sessionFiles = sessionLimit
      ? allSessionFiles.slice(0, sessionLimit)
      : allSessionFiles;

    if (sessionLimit) {
      logger.debug("batch-rebuild", `  (limited to ${sessionLimit} for testing)`);
    }

    // Step 3: Determine which sessions need analysis
    logger.info("batch-rebuild", "\n[3/7] Checking cache...");
    const { toAnalyze, cached } = incremental
      ? this.partitionSessions(sessionFiles)
      : { toAnalyze: sessionFiles, cached: [] };

    logger.info("batch-rebuild", `✓ Cache hit: ${cached.length}, Cache miss: ${toAnalyze.length}`);
    const cacheHitRate = sessionFiles.length > 0
      ? (cached.length / sessionFiles.length) * 100
      : 0;
    logger.debug("batch-rebuild", `  Cache hit rate: ${cacheHitRate.toFixed(1)}%`);

    // Preload ONNX model eagerly before the analysis loop, so the first
    // session does not pay the lazy-loading cost and all subsequent sessions
    // benefit from a ready session. Safe to call even when onnx-local is
    // not configured — it no-ops silently.
    if (toAnalyze.length > 0) {
      logger.info("batch-rebuild", "\n[3.5/7] Preloading ONNX model...");
      const preloadStart = Date.now();
      await EmbeddingEncoder.preloadOnnx();
      const preloadMs = Date.now() - preloadStart;
      if (EmbeddingEncoder.isOnnxReady()) {
        logger.info("batch-rebuild", `✓ ONNX model ready (${preloadMs}ms)`);
      } else {
        logger.debug("batch-rebuild", `  ONNX not available — using char-ngram-tfidf backend (${preloadMs}ms)`);
      }
    }

    // Step 4: Analyze new/changed sessions
    logger.info("batch-rebuild", "\n[4/7] Analyzing sessions...");
    const newPatterns: Pattern[] = [];

    for (let i = 0; i < toAnalyze.length; i++) {
      const sessionFile = toAnalyze[i];
      const sessionId = this.extractSessionId(sessionFile);

      try {
        logger.debug("batch-rebuild", `  [${i + 1}/${toAnalyze.length}] Analyzing ${sessionId}...`);

        const patterns = await this.analyzer.analyzeSession(sessionFile, {
          incremental: false,
          forceReanalyze: true,
          useCompactCache: true,
        });

        this.attachProjectPath(patterns, sessionFile);

        newPatterns.push(...patterns);

        // Update cache with pattern fingerprints
        const fingerprints = patterns.map(p =>
          this.evolutionManager.generateFingerprint(p)
        );

        const stats = statSync(sessionFile);
        this.cacheManager.saveAnalysis(
          sessionId,
          sessionFile,
          patterns.length,
          stats.size,
          patterns,
          fingerprints
        );

        logger.debug("batch-rebuild", `    ✓ Found ${patterns.length} patterns`);
      } catch (error) {
        logger.warn("batch-rebuild", `    ✗ Error analyzing ${sessionId}`, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    logger.info("batch-rebuild", `✓ Analyzed ${toAnalyze.length} sessions, found ${newPatterns.length} new patterns`);

    // Step 5: Merge cached patterns
    logger.info("batch-rebuild", "\n[5/7] Merging patterns...");
    const cachedPatterns = this.extractCachedPatterns(cached);
    const allPatterns = [...cachedPatterns, ...newPatterns];

    logger.info("batch-rebuild", `✓ Total patterns: ${allPatterns.length} (${cachedPatterns.length} cached + ${newPatterns.length} new)`);

    // Step 6: Update pattern evolution and calculate enhanced confidence
    logger.info("batch-rebuild", "\n[6/7] Updating pattern evolution...");
    const enhancedPatterns: Pattern[] = [];

    for (const pattern of allPatterns) {
      const sessionId = this.extractSessionIdFromPattern(pattern);
      const fingerprint = this.evolutionManager.recordOccurrence(
        pattern,
        sessionId
      );

      // Calculate enhanced confidence
      const enhancedConfidence = this.evolutionManager.calculateEnhancedConfidence(
        pattern.confidence,
        fingerprint
      );

      const enhancedPattern = { ...pattern, confidence: enhancedConfidence };
      enhancedPatterns.push(enhancedPattern);
    }

    // Filter out meta / self-reference noise patterns before rule generation (P1-C1).
    // These are discussions about the assistant/tool itself (e.g. "strictly follow
    // the rules", "avoid hardcoding memory support values") that should never become
    // learned rules.
    const noiseResult = filterNoisePatterns(enhancedPatterns);
    if (noiseResult.removed.length > 0) {
      logger.info("batch-rebuild", `✓ Filtered ${noiseResult.removed.length} noise pattern(s) (meta/self-reference):`);
      for (const r of noiseResult.removed) {
        logger.debug("batch-rebuild", `  - ${r.pattern.description.slice(0, 80)} [${r.reasons.join(", ")}]`);
      }
    }

    // Filter by confidence gate (P2-D): global minConfidence is a quality floor,
    // but a pattern below it still qualifies when the per-type classifier graded
    // gate accepts it (sparse / single-session patterns like a lone PREFERENCE).
    const classifier = new RuleClassifier();
    const qualifiedPatterns = noiseResult.kept.filter((p) =>
      isPatternQualifiedForRules(p, minConfidence, classifier)
    );

    // D2: explicit, actionable hint when the gate produces nothing despite patterns
    // being found — instead of silently emitting 0 rules.
    if (qualifiedPatterns.length === 0 && allPatterns.length > 0) {
      logger.warn(
        "batch-rebuild",
        `✗ 0 rules qualified: found ${allPatterns.length} pattern(s) but all were filtered ` +
          `(global minConfidence=${minConfidence.toFixed(2)}, noise removed ${noiseResult.removed.length}). ` +
          `Suggestion: lower --min-confidence or provide more sessions to cross the per-type threshold.`
      );
    }

    logger.info("batch-rebuild", `✓ Enhanced ${enhancedPatterns.length} patterns`);
    logger.debug("batch-rebuild", `  Qualified (>= ${minConfidence}): ${qualifiedPatterns.length}`);
    logger.debug("batch-rebuild", `  Filtered out: ${enhancedPatterns.length - qualifiedPatterns.length}`);

    if (dryRun) {
      logger.debug("batch-rebuild", "\n[DRY RUN] Skipping rule generation");
      return {
        sessions_analyzed: toAnalyze.length,
        sessions_cached: cached.length,
        patterns_total: allPatterns.length,
        patterns_qualified: qualifiedPatterns.length,
        rules_generated: 0,
        rules_exported: 0,
        cache_hit_rate: cacheHitRate,
        execution_time_ms: Date.now() - startTime,
      };
    }

    // Step 7: Generate rules
    logger.info("batch-rebuild", "\n[7/7] Generating rules...");

    // This is a full rebuild: replace the previous generated rule set instead
    // of appending to it. Otherwise stale low-quality rules survive forever.
    const existingRules = this.indexManager.getAllRules();
    logger.debug("batch-rebuild", `  Existing rules to replace: ${existingRules.length}`);

    // Generate from a clean ID range; the old index is cleared only after
    // generation succeeds, so a failed LLM call does not erase the database.
    let nextIdNum = 1;

    // Generate rules with batch LLM optimization (if enabled)
    const scene: Scene = { tech: [], functional: [], business: [] };
    const useBatchLLM = options.useBatchLLM ?? (enhancedRuleOptions.useLLMEnhancement ?? false);

    let rules: Array<{ indexEntry: RuleIndexEntry; content: RuleContent }>;

    // ---- P2: Memory-driven rule generation (optimization 1) ----
    // Only promote when we have enough sessions for cross-session evidence to
    // exist (optimization 2: skip promotion overhead on tiny batches).
    const shouldPromote = useBatchLLM && toAnalyze.length >= 3;
    let promotedMemories: MemoryRecord[] = [];
    if (shouldPromote) {
      promotedMemories = await this.memoryPromotion.promoteEligibleWithLLM({ totalSessions: toAnalyze.length });
    } else {
      promotedMemories = this.memoryPromotion.promoteEligible({ totalSessions: toAnalyze.length }); // heuristic only, no LLM
    }
    if (promotedMemories.length > 0) {
      logger.info("batch-rebuild", `Promoted ${promotedMemories.length} procedural memories → memory-driven rules`);
    }

    // ---- Generate rules: memory-driven first, pattern-driven fallback ----
    const memoryDrivenRules: Array<{ indexEntry: RuleIndexEntry; content: RuleContent }> = [];
    const coveredPatternIds = new Set<string>();

    if (promotedMemories.length > 0) {
      const memoryInputs = promotedMemories.map(m => MemoryRuleAdapter.fromPromotedMemory(m));
      logger.info("batch-rebuild", `  Memory-driven: generating rules from ${memoryInputs.length} promoted memories`);

      for (const input of memoryInputs) {
        const ruleId = `rule-${String(nextIdNum).padStart(3, "0")}`;
        const result = await this.ruleGenerator.generateRuleFromMemory(
          input,
          ruleId,
          scene,
          {
            ...enhancedRuleOptions,
            useLLMEnhancement: true,
          }
        );

        if (result) {
          memoryDrivenRules.push(result);
          nextIdNum++;

          // Track which qualifiedPatterns are covered by this memory
          for (const pattern of qualifiedPatterns) {
            const patternText = pattern.description.toLowerCase();
            const memoryText = input.content.toLowerCase();
            if (patternText.includes(memoryText.slice(0, 40)) ||
                memoryText.includes(patternText.slice(0, 40))) {
              coveredPatternIds.add(pattern.description);
            }
          }
        }
      }

      if (memoryDrivenRules.length > 0) {
        logger.info("batch-rebuild", `✓ Memory-driven: ${memoryDrivenRules.length} rules from promoted memories`);
      }
    }

    // ---- Fallback: pattern-driven generation for uncovered patterns ----
    const uncoveredPatterns = qualifiedPatterns.filter(
      p => !coveredPatternIds.has(p.description)
    );

    if (uncoveredPatterns.length > 0) {
      if (useBatchLLM) {
        logger.info("batch-rebuild", `  Pattern-driven fallback: ${uncoveredPatterns.length} uncovered patterns → batch LLM`);
        const batchRules = await this.batchLLMGenerator.batchGenerateRules(
          uncoveredPatterns,
          nextIdNum,
          scene,
          options.batchLLMOptions
        );

        const converted = batchRules.map(r => ({
          indexEntry: r.indexEntry,
          content: r.content
        }));

        rules = [...memoryDrivenRules, ...converted];

        const totalDeduped = batchRules.reduce((sum, r) => sum + r.dedup_count, 0);
        logger.info("batch-rebuild", `✓ Generated ${rules.length} rules (${memoryDrivenRules.length} memory-driven + ${converted.length} pattern-driven, deduplicated ${totalDeduped} patterns)`);
      } else {
        logger.info("batch-rebuild", `  Using standard rule generation (non-LLM)...`);
        const enhanced = await this.ruleGenerator.batchGenerateEnhancedRules(
          uncoveredPatterns,
          nextIdNum,
          scene,
          enhancedRuleOptions
        );
        rules = [...memoryDrivenRules, ...enhanced];
        logger.info("batch-rebuild", `✓ Generated ${rules.length} rules`);
      }
    } else if (memoryDrivenRules.length > 0) {
      rules = memoryDrivenRules;
      logger.info("batch-rebuild", `✓ Generated ${rules.length} rules (all memory-driven)`);
    } else {
      // Nothing generated — no promoted memories AND no qualified patterns
      rules = [];
      logger.warn("batch-rebuild", `⚠  No rules generated (0 promoted memories, 0 qualified patterns)`);
    }

    // Attach consolidated memory support before the final quality gate.
    // Reload the memory store so any memories persisted during analysis
    // (or by other processes) are visible before we resolve rule↔memory links.
    this.memoryStore.reload?.();
    rules = rules.map(rule => {
      const support = this.findSupportingMemories(rule);
      rule.indexEntry.source_memory_ids = support.ids;
      rule.indexEntry.status = support.ids.length > 0 && support.score >= UNIFIED_RULE_MIN_SCORE ? "active" : "candidate";
      rule.content.metadata.source_memory_ids = support.ids;
      rule.content.metadata.memory_support_score = support.score;
      const unified = this.qualityController.assessUnifiedScore(
        rule.content,
        rule.indexEntry,
        rule.content.metadata?.evidence_confidence ?? rule.indexEntry.confidence,
        rule.content.metadata?.scope_confidence ?? rule.indexEntry.scope_confidence ?? 0.5,
        support.score
      );
      rule.indexEntry.confidence = unified.overall;
      rule.content.metadata.quality_score = unified.overall;
      rule.content.metadata.confidence = unified.overall;
      return rule;
    });

    // Reject unusable LLM/fallback output before persisting it.
    const generatedBeforeQualityFilter = rules.length;
    rules = rules.filter(rule => {
      const quality = rule.content.metadata?.quality_score ?? rule.indexEntry.confidence;
      return quality >= UNIFIED_RULE_MIN_SCORE;
    });
    if (rules.length !== generatedBeforeQualityFilter) {
      logger.warn("batch-rebuild", `Skipped ${generatedBeforeQualityFilter - rules.length} rules with unified score below ${UNIFIED_RULE_MIN_SCORE}`);
    }

    // Deduplicate rules produced in the same rebuild, not only against the
    // previous database state. This is especially important in non-LLM mode.
    rules = this.deduplicateGeneratedRules(rules);

    // Save rules and update evolution with rule IDs. Replace the previous
    // generated set only after all generation/quality checks have completed.
    const removedRules = this.indexManager.clearAllRules();
    logger.debug("batch-rebuild", `  Removed ${removedRules} previous rules`);
    const removedContent = this.contentManager.clearAllContent();
    logger.debug("batch-rebuild", `  Removed ${removedContent} previous rule content files`);
    for (const rule of rules) {
      // Pass content to addRule for SQLite storage (saves content inline)
      this.indexManager.addRule(rule.indexEntry, rule.content);
      // Also save to content manager for backward compatibility with JSON storage
      this.contentManager.saveContent(rule.content);
      this.linkRuleToMemories(rule);

      // Find corresponding pattern and update evolution
      const pattern = qualifiedPatterns.find(
        p => p.description === rule.content.description
      );

      if (pattern) {
        const fingerprint = this.evolutionManager.generateFingerprint(pattern);
        const sessionId = this.extractSessionIdFromPattern(pattern);
        this.evolutionManager.recordOccurrence(pattern, sessionId, rule.indexEntry.id);
      }
    }

    // Step 8: Auto-cleanup (optional). Batch LLM clustering does not replace
    // quality/conflict cleanup, so cleanup is no longer skipped automatically.
    let cleanupPerformed = false;
    let mergedCount = 0;
    let optimizedCount = 0;
    let deletedCount = 0;

    const skipCleanup = false;

    if (options.autoCleanup && !skipCleanup) {
      logger.debug("batch-rebuild", "\n[8/8] Running auto-cleanup...");

      // Load all rules and contents
      const allRules = this.indexManager.getAllRules();
      const allContents = new Map<string, RuleContent>();
      for (const rule of allRules) {
        const content = this.contentManager.loadContent(rule.id);
        if (content) {
          allContents.set(rule.id, content);
        }
      }

      // Scan for issues
      const cleanupReport = this.cleanupService.scanExistingRules(allRules, allContents);
      logger.debug("batch-rebuild", `  Found ${cleanupReport.duplicateGroups.length} duplicate groups`);
      logger.debug("batch-rebuild", `  Found ${cleanupReport.lowQualityRules.length} low-quality rules`);

      // Execute cleanup
      const cleanupResult = this.cleanupService.executeCleanup(
        cleanupReport.duplicateGroups,
        cleanupReport.lowQualityRules,
        allRules,
        allContents,
        {
          mergeDuplicates: options.mergeDuplicates ?? true,
          optimizeLowQuality: options.optimizeLowQuality ?? true,
          deleteVeryLowQuality: options.deleteVeryLowQuality ?? false,
          veryLowQualityThreshold: options.veryLowQualityThreshold ?? 0.3,
        }
      );

      if (cleanupResult.success) {
        cleanupPerformed = true;
        mergedCount = cleanupResult.mergedCount;
        optimizedCount = cleanupResult.optimizedCount;
        deletedCount = cleanupResult.deletedCount;

        logger.info("batch-rebuild", `✓ Cleanup complete:`);
        logger.debug("batch-rebuild", `  - Merged: ${mergedCount} rules`);
        logger.debug("batch-rebuild", `  - Optimized: ${optimizedCount} rules`);
        logger.debug("batch-rebuild", `  - Deleted: ${deletedCount} rules`);

        if (cleanupResult.errors.length > 0) {
          logger.debug("batch-rebuild", `  - Errors: ${cleanupResult.errors.length}`);
          for (const error of cleanupResult.errors.slice(0, 3)) {
            logger.debug("batch-rebuild", `    ${error}`);
          }
        }
      } else {
        logger.debug("batch-rebuild", `✗ Cleanup failed with ${cleanupResult.errors.length} errors`);
      }
    } else if (skipCleanup) {
      logger.debug("batch-rebuild", "\n[8/8] Skipping cleanup (batch LLM already deduplicated)");
    }

    // Export to Claude index
    logger.debug("batch-rebuild", "\nExporting to Claude index...");
    const exportEligible = this.indexManager.listRules({ minConfidence }).length;
    logger.debug("batch-rebuild", `  Export filter: ${exportEligible} rules meet confidence >= ${minConfidence}`);
    const exported = this.exporter.export({
      strategy: "category-balanced",
      limit: 10,
      minConfidence,
    });

    logger.info("batch-rebuild", `✓ Exported ${exported.rulesExported} rules to Claude index`);

    const executionTime = Date.now() - startTime;
    logger.info("batch-rebuild", `\n=== Rebuild Complete ===`);
    logger.debug("batch-rebuild", `Execution time: ${(executionTime / 1000).toFixed(1)}s`);

    return {
      sessions_analyzed: toAnalyze.length,
      sessions_cached: cached.length,
      patterns_total: allPatterns.length,
      patterns_qualified: qualifiedPatterns.length,
      rules_generated: rules.length,
      rules_exported: exported.rulesExported,
      cache_hit_rate: cacheHitRate,
      execution_time_ms: executionTime,
      cleanup_performed: cleanupPerformed,
      rules_merged: mergedCount,
      rules_optimized: optimizedCount,
      rules_deleted: deletedCount,
    };
  }

  private findSupportingMemories(rule: { indexEntry: RuleIndexEntry; content: RuleContent }): { ids: string[]; score: number } {
    // Prefer the rule's explicit memory references. Memory-driven rules get
    // [memoryInput.memory_id] set by generateRuleFromMemory, and batch-LLM
    // rules get cluster.source_memory_ids — these are the true provenance.
    // Fuzzy-search only when no explicit references exist, so we never
    // overwrite the real provenance with unrelated search hits.
    const explicitIds = rule.indexEntry.source_memory_ids?.length
      ? rule.indexEntry.source_memory_ids
      : (rule.content.metadata?.source_memory_ids as string[] | undefined)?.length
        ? (rule.content.metadata?.source_memory_ids as string[])
        : [];
    if (explicitIds.length > 0) {
      return resolveMemorySupport(this.memoryStore, explicitIds);
    }

    const query = rule.content.description || rule.content.content || rule.indexEntry.description || "";
    if (!query.trim()) return { ids: [], score: FALLBACK_MEMORY_SUPPORT };
    const filters = {
      projectPath: rule.indexEntry.scope_context?.project_path,
      organizationId: rule.indexEntry.scope_context?.organization_id,
      repository: rule.indexEntry.scope_context?.repository,
      branch: rule.indexEntry.scope_context?.branch
    };
    const ids = findRelevantMemoryIds(this.memoryStore, query, filters);
    if (ids.length === 0) return { ids: [], score: FALLBACK_MEMORY_SUPPORT };
    return resolveMemorySupport(this.memoryStore, ids);
  }

  private linkRuleToMemories(rule: { indexEntry: RuleIndexEntry; content: RuleContent }): void {
    if (!this.memoryStore.linkRule) return;
    const now = new Date().toISOString();
    for (const memoryId of rule.indexEntry.source_memory_ids || []) {
      const memory = this.memoryStore.list({ activeOnly: false }).find(item => item.id === memoryId);
      this.memoryStore.linkRule({
        memory_id: memoryId,
        rule_id: rule.indexEntry.id,
        relation: "supports",
        support_score: memory ? memory.confidence : 0.5,
        created_at: now,
        updated_at: now
      });
    }
  }

  private deduplicateGeneratedRules(
    rules: Array<{ indexEntry: RuleIndexEntry; content: RuleContent }>
  ): Array<{ indexEntry: RuleIndexEntry; content: RuleContent }> {
    const kept: Array<{ indexEntry: RuleIndexEntry; content: RuleContent }> = [];
    for (const candidate of rules) {
      const similarities = this.deduplicator.findSimilarRules(
        candidate.indexEntry,
        kept.map(rule => rule.indexEntry),
        new Map(kept.map(rule => [rule.indexEntry.id, rule.content]))
      );
      const top = similarities[0];
      if (!top || top.action === "keep-separate") {
        kept.push(candidate);
        continue;
      }
      const targetIndex = kept.findIndex(rule => rule.indexEntry.id === top.existingRuleId);
      if (targetIndex < 0) {
        kept.push(candidate);
        continue;
      }
      const merged = this.deduplicator.mergeRules(
        kept[targetIndex].indexEntry,
        candidate.indexEntry,
        kept[targetIndex].content,
        candidate.content
      );
      kept[targetIndex] = {
        indexEntry: merged.indexEntry,
        content: merged.content || kept[targetIndex].content
      };
    }
    return kept;
  }

  /**
   * Discover all session .jsonl and .json files
   */
  private discoverSessionFiles(baseDir: string): string[] {
    if (baseDir.replace(/\\/g, "/").includes("/.kiro/sessions")) {
      return this.discoverKiroSessionFiles(baseDir);
    }
    const sessionFiles: string[] = [];

    try {
      const projectDirs = readdirSync(baseDir);

      for (const projectDir of projectDirs) {
        const projectPath = join(baseDir, projectDir);

        try {
          const stat = statSync(projectPath);
          if (stat.isDirectory()) {
            const files = readdirSync(projectPath);
            for (const file of files) {
              if (file.endsWith(".jsonl") || file.endsWith(".json")) {
                sessionFiles.push(join(projectPath, file));
              }
            }
          } else if (projectDir.endsWith(".jsonl") || projectDir.endsWith(".json")) {
            // Sessions may also live directly at the base directory level.
            sessionFiles.push(projectPath);
          }
        } catch (error) {
          // Skip inaccessible entries
          continue;
        }
      }
    } catch (error) {
      logger.warn("batch-rebuild", "Error discovering session files", { error: error instanceof Error ? error.message : String(error) });
    }

    return sessionFiles;
  }

  private discoverKiroSessionFiles(baseDir: string): string[] {
    const result: string[] = [];
    const walk = (dir: string): void => {
      let entries: string[];
      try { entries = readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        const path = join(dir, entry);
        let stat;
        try { stat = statSync(path); } catch { continue; }
        if (stat.isDirectory()) { walk(path); continue; }
        const normalized = path.replace(/\\/g, "/");
        if (entry.endsWith(".jsonl") && normalized.includes("/.kiro/sessions/cli/")) {
          result.push(path);
        } else if (entry === "messages.json" && /\/sess_[^/]+\/messages\.json$/i.test(normalized)) {
          result.push(path);
        }
      }
    };
    walk(baseDir);
    return result;
  }

  /**
   * Partition sessions into: need analysis vs. use cache
   */
  private partitionSessions(sessionFiles: string[]): {
    toAnalyze: string[];
    cached: string[];
  } {
    const toAnalyze: string[] = [];
    const cached: string[] = [];

    for (const sessionFile of sessionFiles) {
      const sessionId = this.extractSessionId(sessionFile);
      const hasChanged = this.cacheManager.hasSessionChanged(sessionFile, sessionId);

      if (hasChanged) {
        toAnalyze.push(sessionFile);
      } else {
        cached.push(sessionFile);
      }
    }

    return { toAnalyze, cached };
  }

  /**
   * Extract patterns from cached sessions
   */
  private extractCachedPatterns(cachedSessionFiles: string[]): Pattern[] {
    const patterns: Pattern[] = [];

    for (const sessionFile of cachedSessionFiles) {
      const sessionId = this.extractSessionId(sessionFile);
      const cached = this.cacheManager.getCached(sessionId);

      if (cached && cached.cached_patterns) {
        this.attachProjectPath(cached.cached_patterns, sessionFile);
        patterns.push(...cached.cached_patterns);
      }
    }

    return patterns;
  }

  private attachProjectPath(patterns: Pattern[], sessionFile: string): void {
    try {
      const projectPath = this.parser.parseFile(sessionFile).project_path;
      if (!projectPath) return;
      for (const pattern of patterns) {
        pattern.project_paths = Array.from(new Set([...(pattern.project_paths || []), projectPath]));
      }
    } catch (error) {
      logger.debug("batch-rebuild", `Unable to attach project scope context for ${sessionFile}`, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Extract session ID from file path
   */
  private extractSessionId(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const filename = normalized.split("/").pop() || "";
    if (filename === "messages.json") {
      const parent = normalized.split("/").slice(-2, -1)[0] || "";
      return parent.replace(/^sess_/, "");
    }
    return filename.replace(/\.(jsonl|json)$/, "");
  }

  /**
   * Extract session ID from pattern occurrence
   */
  private extractSessionIdFromPattern(pattern: Pattern): string {
    // Use first occurrence's session ID if available
    if (pattern.occurrences && pattern.occurrences.length > 0) {
      return pattern.occurrences[0].session_id || "unknown";
    }
    return "unknown";
  }

  /**
   * Clean up resources (close database connections)
   */
  cleanup(): void {
    this.indexManager.close();
  }
}
