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
import { SessionCacheManager } from "../storage/session-cache.js";
import { PatternEvolutionManager } from "../storage/pattern-evolution.js";
import { HybridRuleGenerator, EnhancedRuleOptions } from "./hybrid-rule-generator.js";
import { BatchLLMRuleGenerator, BatchLLMOptions } from "./batch-llm-rule-generator.js";
import { RuleIndexManager } from "../storage/rule-index.js";
import { RuleContentManager } from "../storage/rule-content.js";
import { ClaudeIndexExporter } from "../tools/export-rules-to-claude.js";
import { Pattern, Scene, RuleIndexEntry, RuleContent } from "./models.js";
import { RuleCleanupService, CleanupReport } from "./rule-cleanup-service.js";
import { homedir } from "os";

export interface BatchRebuildOptions {
  /** Clear all caches before rebuild */
  force?: boolean;

  /** Use cached results (default: true) */
  incremental?: boolean;

  /** Minimum confidence threshold */
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

export class BatchRebuildEngine {
  private analyzer: SessionAnalyzer;
  private cacheManager: SessionCacheManager;
  private evolutionManager: PatternEvolutionManager;
  private ruleGenerator: HybridRuleGenerator;
  private batchLLMGenerator: BatchLLMRuleGenerator;
  private indexManager: RuleIndexManager;
  private contentManager: RuleContentManager;
  private exporter: ClaudeIndexExporter;
  private cleanupService: RuleCleanupService;

  constructor() {
    this.analyzer = new SessionAnalyzer();
    this.cacheManager = new SessionCacheManager();
    this.evolutionManager = new PatternEvolutionManager();
    this.ruleGenerator = new HybridRuleGenerator();
    this.batchLLMGenerator = new BatchLLMRuleGenerator();
    this.indexManager = new RuleIndexManager();
    this.contentManager = new RuleContentManager();
    this.exporter = new ClaudeIndexExporter(this.indexManager, this.contentManager);
    this.cleanupService = new RuleCleanupService();
  }

  /**
   * Execute batch rebuild
   */
  async rebuild(options: BatchRebuildOptions = {}): Promise<BatchRebuildResult> {
    const startTime = Date.now();

    const {
      force = false,
      incremental = true,
      minConfidence = 0.40,
      sessionLimit,
      dryRun = false,
      sessionDir = join(homedir(), ".claude", "projects"),
      enhancedRuleOptions = {},
    } = options;

    // console.error("=== AutoImprove Batch Rebuild ===");
    // console.error(`Mode: ${force ? "FORCE (clear cache)" : incremental ? "INCREMENTAL" : "FULL"}`);
    // console.error(`Min confidence: ${minConfidence}`);
    // console.error(`Dry run: ${dryRun}`);

    // Step 1: Clear caches if force mode
    if (force) {
      // console.error("\n[1/7] Clearing caches...");
      this.cacheManager.clearAll();
      // console.error("✓ Cache cleared");
    }

    // Step 2: Discover all session files
    // console.error("\n[2/7] Discovering session files...");
    const allSessionFiles = this.discoverSessionFiles(sessionDir);
    // console.error(`✓ Found ${allSessionFiles.length} session files`);

    const sessionFiles = sessionLimit
      ? allSessionFiles.slice(0, sessionLimit)
      : allSessionFiles;

    if (sessionLimit) {
      // console.error(`  (limited to ${sessionLimit} for testing)`);
    }

    // Step 3: Determine which sessions need analysis
    // console.error("\n[3/7] Checking cache...");
    const { toAnalyze, cached } = incremental
      ? this.partitionSessions(sessionFiles)
      : { toAnalyze: sessionFiles, cached: [] };

    // console.error(`✓ Cache hit: ${cached.length}, Cache miss: ${toAnalyze.length}`);
    const cacheHitRate = sessionFiles.length > 0
      ? (cached.length / sessionFiles.length) * 100
      : 0;
    // console.error(`  Cache hit rate: ${cacheHitRate.toFixed(1)}%`);

    // Step 4: Analyze new/changed sessions
    // console.error("\n[4/7] Analyzing sessions...");
    const newPatterns: Pattern[] = [];

    for (let i = 0; i < toAnalyze.length; i++) {
      const sessionFile = toAnalyze[i];
      const sessionId = this.extractSessionId(sessionFile);

      try {
        // console.error(`  [${i + 1}/${toAnalyze.length}] Analyzing ${sessionId}...`);

        const patterns = this.analyzer.analyzeSession(sessionFile, {
          incremental: false,
          forceReanalyze: true,
          useCompactCache: true,
        });

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

        // console.error(`    ✓ Found ${patterns.length} patterns`);
      } catch (error) {
        // console.error(`    ✗ Error analyzing ${sessionId}:`, error);
      }
    }

    // console.error(`✓ Analyzed ${toAnalyze.length} sessions, found ${newPatterns.length} new patterns`);

    // Step 5: Merge cached patterns
    // console.error("\n[5/7] Merging patterns...");
    const cachedPatterns = this.extractCachedPatterns(cached);
    const allPatterns = [...cachedPatterns, ...newPatterns];

    // console.error(`✓ Total patterns: ${allPatterns.length} (${cachedPatterns.length} cached + ${newPatterns.length} new)`);

    // Step 6: Update pattern evolution and calculate enhanced confidence
    // console.error("\n[6/7] Updating pattern evolution...");
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

    // Filter by confidence threshold
    const qualifiedPatterns = enhancedPatterns.filter(
      p => p.confidence >= minConfidence
    );

    // console.error(`✓ Enhanced ${enhancedPatterns.length} patterns`);
    // console.error(`  Qualified (>= ${minConfidence}): ${qualifiedPatterns.length}`);
    // console.error(`  Filtered out: ${enhancedPatterns.length - qualifiedPatterns.length}`);

    if (dryRun) {
      // console.error("\n[DRY RUN] Skipping rule generation");
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
    // console.error("\n[7/7] Generating rules...");

    // Clear existing rules
    const existingRules = this.indexManager.getAllRules();
    // console.error(`  Backing up ${existingRules.length} existing rules...`);

    // Get next rule ID
    const nextId = existingRules.length > 0
      ? Math.max(...existingRules.map((r: RuleIndexEntry) => parseInt(r.id.replace("rule-", "")))) + 1
      : 1;

    // Generate rules with batch LLM optimization (if enabled)
    const scene: Scene = { tech: [], functional: [], business: [] };
    const useBatchLLM = options.useBatchLLM ?? (enhancedRuleOptions.useLLMEnhancement ?? false);

    let rules: Array<{ indexEntry: RuleIndexEntry; content: RuleContent }>;

    if (useBatchLLM) {
      // console.error(`  Using batch LLM optimization (clustering + intelligent merging)...`);

      const batchRules = await this.batchLLMGenerator.batchGenerateRules(
        qualifiedPatterns,
        nextId,
        scene,
        options.batchLLMOptions
      );

      // Convert to standard format
      rules = batchRules.map(r => ({
        indexEntry: r.indexEntry,
        content: r.content
      }));

      const totalDeduped = batchRules.reduce((sum, r) => sum + r.dedup_count, 0);
      // console.error(`✓ Generated ${rules.length} rules (deduplicated ${totalDeduped} patterns)`);
    } else {
      // console.error(`  Using standard rule generation...`);

      rules = await this.ruleGenerator.batchGenerateEnhancedRules(
        qualifiedPatterns,
        nextId,
        scene,
        enhancedRuleOptions
      );

      // console.error(`✓ Generated ${rules.length} rules`);
    }

    // Save rules and update evolution with rule IDs
    for (const rule of rules) {
      this.indexManager.addRule(rule.indexEntry);
      this.contentManager.saveContent(rule.content);

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

    // Step 8: Auto-cleanup (optional)
    // Skip if batch LLM already performed deduplication
    let cleanupPerformed = false;
    let mergedCount = 0;
    let optimizedCount = 0;
    let deletedCount = 0;

    const skipCleanup = useBatchLLM && !options.forceCleanup;

    if (options.autoCleanup && !skipCleanup) {
      // console.error("\n[8/8] Running auto-cleanup...");

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
      // console.error(`  Found ${cleanupReport.duplicateGroups.length} duplicate groups`);
      // console.error(`  Found ${cleanupReport.lowQualityRules.length} low-quality rules`);

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

        // console.error(`✓ Cleanup complete:`);
        // console.error(`  - Merged: ${mergedCount} rules`);
        // console.error(`  - Optimized: ${optimizedCount} rules`);
        // console.error(`  - Deleted: ${deletedCount} rules`);

        if (cleanupResult.errors.length > 0) {
          // console.error(`  - Errors: ${cleanupResult.errors.length}`);
          for (const error of cleanupResult.errors.slice(0, 3)) {
            // console.error(`    ${error}`);
          }
        }
      } else {
        // console.error(`✗ Cleanup failed with ${cleanupResult.errors.length} errors`);
      }
    } else if (skipCleanup) {
      // console.error("\n[8/8] Skipping cleanup (batch LLM already deduplicated)");
    }

    // Export to Claude index
    // console.error("\nExporting to Claude index...");
    const exported = this.exporter.export({
      strategy: "category-balanced",
      limit: 10,
      minConfidence: 0.6,
    });

    // console.error(`✓ Exported ${exported.rulesExported} rules to Claude index`);

    const executionTime = Date.now() - startTime;
    // console.error(`\n=== Rebuild Complete ===`);
    // console.error(`Execution time: ${(executionTime / 1000).toFixed(1)}s`);

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

  /**
   * Discover all session .jsonl files
   */
  private discoverSessionFiles(baseDir: string): string[] {
    const sessionFiles: string[] = [];

    try {
      const projectDirs = readdirSync(baseDir);

      for (const projectDir of projectDirs) {
        const projectPath = join(baseDir, projectDir);

        try {
          const stat = statSync(projectPath);
          if (!stat.isDirectory()) continue;

          const files = readdirSync(projectPath);

          for (const file of files) {
            if (file.endsWith(".jsonl")) {
              sessionFiles.push(join(projectPath, file));
            }
          }
        } catch (error) {
          // Skip inaccessible directories
          continue;
        }
      }
    } catch (error) {
      // console.error("Error discovering session files:", error);
    }

    return sessionFiles;
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
        patterns.push(...cached.cached_patterns);
      }
    }

    return patterns;
  }

  /**
   * Extract session ID from file path
   */
  private extractSessionId(filePath: string): string {
    const filename = filePath.split("/").pop() || "";
    return filename.replace(".jsonl", "");
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
}
