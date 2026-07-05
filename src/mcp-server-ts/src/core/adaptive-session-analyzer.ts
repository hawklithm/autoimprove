/**
 * Adaptive Session Analyzer - integrates signal-based pattern recognition
 */

import { Pattern, PatternType, createPattern } from "./models.js";
import { UnifiedSessionParser, SessionData } from "./unified-session-parser.js";
import { ConfidenceCalculator } from "./confidence.js";
import { SessionCacheManager } from "../storage/session-cache.js";
import { CompactCacheManager } from "../storage/compact-cache.js";
import { SignalMatcher, MatchResult } from "./signal-matcher.js";
import { LLMSignalExtractor } from "./llm-signal-extractor.js";
import { BayesianConfidenceUpdater } from "./bayesian-confidence-updater.js";
import { PatternClusterer } from "./pattern-clusterer.js";
import { LLMRuleGenerator } from "./llm-rule-generator.js";
import { SignalDictionaryDB } from "../storage/signal-dictionary-db.js";
import { statSync } from "fs";
import { logger } from "./logger.js";

export interface AdaptiveAnalysisOptions {
  incremental?: boolean;
  forceReanalyze?: boolean;
  useCompactCache?: boolean;
  enableSignalExtraction?: boolean;
  enableClustering?: boolean;
  enableRuleGeneration?: boolean;
}

export interface AdaptiveAnalysisResult {
  patterns: Pattern[];
  signal_matches: {
    total_messages: number;
    matched_messages: number;
    unmatched_messages: number;
    match_rate: number;
  };
  signal_extraction?: {
    new_signals: number;
    total_analyzed: number;
  };
  clustering?: {
    total_clusters: number;
    avg_cluster_size: number;
  };
  rules_generated?: {
    total_rules: number;
    rule_ids: string[];
  };
}

export class AdaptiveSessionAnalyzer {
  private parser: UnifiedSessionParser;
  private confidenceCalc: ConfidenceCalculator;
  private cacheManager: SessionCacheManager;
  private compactCache: CompactCacheManager;
  private signalMatcher: SignalMatcher;
  private signalExtractor: LLMSignalExtractor;
  private confidenceUpdater: BayesianConfidenceUpdater;
  private clusterer: PatternClusterer;
  private ruleGenerator: LLMRuleGenerator;
  private db: SignalDictionaryDB;

  constructor() {
    this.parser = new UnifiedSessionParser();
    this.confidenceCalc = new ConfidenceCalculator();
    this.cacheManager = new SessionCacheManager();
    this.compactCache = new CompactCacheManager();
    this.signalMatcher = new SignalMatcher();
    this.signalExtractor = new LLMSignalExtractor();
    this.confidenceUpdater = new BayesianConfidenceUpdater();
    this.clusterer = new PatternClusterer();
    this.ruleGenerator = new LLMRuleGenerator();
    this.db = new SignalDictionaryDB();
  }

  /**
   * Analyze session with adaptive signal-based pattern recognition
   */
  async analyzeSession(
    sessionFile: string,
    options: AdaptiveAnalysisOptions = {}
  ): Promise<AdaptiveAnalysisResult> {
    const {
      incremental = true,
      forceReanalyze = false,
      useCompactCache = true,
      enableSignalExtraction = true,
      enableClustering = false,
      enableRuleGeneration = false
    } = options;

    // Load session data (with compact cache optimization)
    const sessionData = this.loadSessionData(sessionFile, useCompactCache);
    const sessionId = sessionData.session_id;

    // Check if we can use cached results
    if (incremental && !forceReanalyze) {
      const hasChanged = this.cacheManager.hasSessionChanged(sessionFile, sessionId);

      if (!hasChanged) {
        const cached = this.cacheManager.getCached(sessionId);
        if (cached) {
          logger.consoleError(`Using cached analysis for session ${sessionId}`);
          return {
            patterns: cached.cached_patterns,
            signal_matches: {
              total_messages: 0,
              matched_messages: 0,
              unmatched_messages: 0,
              match_rate: 0
            }
          };
        }
      }
    }

    // Perform adaptive analysis
    return this.performAdaptiveAnalysis(sessionFile, sessionData, {
      enableSignalExtraction,
      enableClustering,
      enableRuleGeneration
    });
  }

  /**
   * Perform adaptive analysis using signal matching
   */
  private async performAdaptiveAnalysis(
    sessionFile: string,
    sessionData: SessionData,
    options: {
      enableSignalExtraction: boolean;
      enableClustering: boolean;
      enableRuleGeneration: boolean;
    }
  ): Promise<AdaptiveAnalysisResult> {
    logger.consoleError(`Performing adaptive analysis for session ${sessionData.session_id}`);

    const userMessages = this.getUserMessages(sessionData);
    const patterns: Pattern[] = [];

    // Step 1: Match signals in user messages
    const matchResults: MatchResult[] = [];
    const unmatchedContent: string[] = [];

    for (const msg of userMessages) {
      const result = this.signalMatcher.match(
        msg.content,
        sessionData.session_id,
        msg.line_number.toString()
      );

      matchResults.push(result);

      if (!result.is_matched) {
        unmatchedContent.push(msg.content);
      } else {
        // Save labeled content
        this.db.saveLabeledContent({
          message_id: msg.line_number.toString(),
          session_id: sessionData.session_id,
          content: msg.content,
          matched_signals: JSON.stringify(result.matched_signals),
          pattern_type: result.pattern_type || "unknown",
          confidence: result.aggregated_confidence,
          labeled_at: new Date().toISOString(),
          labeling_method: "dictionary"
        });
      }
    }

    // Calculate match statistics
    const matchedCount = matchResults.filter(r => r.is_matched).length;
    const matchRate = userMessages.length > 0 ? matchedCount / userMessages.length : 0;

    logger.consoleError(`Signal matching: ${matchedCount}/${userMessages.length} messages matched (${(matchRate * 100).toFixed(1)}%)`);

    // Step 2: Extract new signals from unmatched content (optional)
    let extractionResult;
    if (options.enableSignalExtraction && unmatchedContent.length > 0) {
      logger.consoleError(`Extracting signals from ${unmatchedContent.length} unmatched messages...`);
      extractionResult = await this.signalExtractor.extractSignals(unmatchedContent);
      logger.consoleError(`✓ Extracted ${extractionResult.new_signals_added} new signals`);

      // Rebuild signal matcher with new signals
      this.signalMatcher.rebuild();
    }

    // Step 3: Convert match results to patterns
    const patternsByType = this.groupMatchResultsByPattern(matchResults);

    for (const [type, results] of Object.entries(patternsByType)) {
      if (results.length === 0) continue;

      const pattern = this.createPatternFromMatches(
        type as PatternType,
        results,
        sessionData
      );

      if (pattern) {
        patterns.push(pattern);
      }
    }

    // Calculate confidence for all patterns
    for (const pattern of patterns) {
      pattern.confidence = this.confidenceCalc.calculateConfidence(pattern);
    }

    // Cache results
    const stats = statSync(sessionFile);
    const totalLines = sessionData.messages.length + sessionData.tool_calls.length;
    this.cacheManager.saveAnalysis(
      sessionData.session_id,
      sessionFile,
      totalLines,
      stats.size,
      patterns
    );

    // Step 4: Cluster patterns (optional)
    let clusteringResult;
    if (options.enableClustering) {
      const labeledContent = this.db.getLabeledContentBySession(sessionData.session_id);
      const clusters = this.clusterer.clusterPatterns(labeledContent);
      const clusterStats = this.clusterer.getClusterStats(clusters);

      logger.consoleError(`✓ Created ${clusters.length} pattern clusters`);
      clusteringResult = {
        total_clusters: clusters.length,
        avg_cluster_size: clusterStats.avg_cluster_size
      };

      // Step 5: Generate rules from clusters (optional)
      if (options.enableRuleGeneration && clusters.length > 0) {
        // Filter high-quality clusters
        const highQualityClusters = clusters.filter(
          c => c.avg_confidence >= 0.7 && c.total_occurrences >= 2
        );

        if (highQualityClusters.length > 0) {
          logger.consoleError(`Generating rules from ${highQualityClusters.length} clusters...`);
          const generatedRules = await this.ruleGenerator.batchGenerateRules(
            highQualityClusters,
            1
          );

          logger.consoleError(`✓ Generated ${generatedRules.length} rules`);

          return {
            patterns,
            signal_matches: {
              total_messages: userMessages.length,
              matched_messages: matchedCount,
              unmatched_messages: unmatchedContent.length,
              match_rate: matchRate
            },
            signal_extraction: extractionResult ? {
              new_signals: extractionResult.new_signals_added,
              total_analyzed: extractionResult.total_content_analyzed
            } : undefined,
            clustering: clusteringResult,
            rules_generated: {
              total_rules: generatedRules.length,
              rule_ids: generatedRules.map(r => r.id)
            }
          };
        }
      }
    }

    return {
      patterns,
      signal_matches: {
        total_messages: userMessages.length,
        matched_messages: matchedCount,
        unmatched_messages: unmatchedContent.length,
        match_rate: matchRate
      },
      signal_extraction: extractionResult ? {
        new_signals: extractionResult.new_signals_added,
        total_analyzed: extractionResult.total_content_analyzed
      } : undefined,
      clustering: clusteringResult
    };
  }

  /**
   * Group match results by pattern type
   */
  private groupMatchResultsByPattern(results: MatchResult[]): Record<string, MatchResult[]> {
    const grouped: Record<string, MatchResult[]> = {};

    for (const result of results) {
      if (!result.is_matched || !result.pattern_type) continue;

      if (!grouped[result.pattern_type]) {
        grouped[result.pattern_type] = [];
      }

      grouped[result.pattern_type].push(result);
    }

    return grouped;
  }

  /**
   * Create pattern from match results
   */
  private createPatternFromMatches(
    type: PatternType,
    results: MatchResult[],
    sessionData: SessionData
  ): Pattern | null {
    if (results.length === 0) return null;

    // Extract descriptions and keywords
    const descriptions: string[] = [];
    const keywordSet = new Set<string>();

    for (const result of results) {
      descriptions.push(result.content);

      for (const signal of result.matched_signals) {
        keywordSet.add(signal.signal_text);
      }
    }

    // Create consolidated description
    const description = this.consolidateDescriptions(descriptions, type);

    // Extract timestamps from results - MatchResult doesn't have timestamp field
    const firstTimestamp = new Date().toISOString();
    const lastTimestamp = new Date().toISOString();

    const pattern = createPattern({
      type,
      description,
      occurrences: results.map((result) => ({
        session_id: sessionData.session_id,
        timestamp: new Date().toISOString(),
        user_action: "explicit_correction" as const,
        context: result.matched_signals.map(s => s.signal_text).join(", ")
      })),
      first_seen: firstTimestamp,
      last_seen: lastTimestamp
    });

    pattern.keywords = Array.from(keywordSet);

    return pattern;
  }

  /**
   * Consolidate multiple descriptions into one
   */
  private consolidateDescriptions(descriptions: string[], type: PatternType): string {
    if (descriptions.length === 1) {
      return descriptions[0];
    }

    // Simple consolidation: take most common patterns
    switch (type) {
      case PatternType.REPEATED_CORRECTION:
        return `Repeated correction pattern detected across ${descriptions.length} messages`;
      case PatternType.ANTI_PATTERN:
        return `Anti-pattern identified in ${descriptions.length} instances`;
      case PatternType.PREFERENCE:
        return `User preference stated ${descriptions.length} times`;
      case PatternType.PERFORMANCE:
        return `Performance concern raised ${descriptions.length} times`;
      case PatternType.SECURITY:
        return `Security issue identified ${descriptions.length} times`;
      default:
        return `Pattern detected in ${descriptions.length} messages`;
    }
  }

  /**
   * Load session data with compact cache
   */
  private loadSessionData(sessionFile: string, useCompactCache: boolean): SessionData {
    if (!useCompactCache) {
      return this.parser.parseFile(sessionFile);
    }

    // Check if compact cache exists and is valid
    if (!this.compactCache.needsRegeneration(sessionFile)) {
      const compactCache = this.compactCache.loadCache(sessionFile);

      if (compactCache) {
        // Calculate bytes saved (compact cache doesn't have compact_size field)
        const cacheContent = JSON.stringify(compactCache);
        const compactSize = Buffer.byteLength(cacheContent, "utf-8");
        const bytesSaved = compactCache.original_size - compactSize;
        const timeSaved = this.estimateTimeSaved(compactCache.original_size);

        this.compactCache.recordCacheHit(timeSaved, bytesSaved);

        // Removed console logging for MCP server compatibility
        // Previously logged: Using compact cache for ${session_id} (saved ${time}ms, ${bytes})

        return this.compactCache.toSessionData(compactCache);
      }
    }

    // Cache miss or needs regeneration
    this.compactCache.recordCacheMiss();

    // Parse the original file
    const sessionData = this.parser.parseFile(sessionFile);

    // Generate compact cache for next time
    this.compactCache.generateCache(sessionFile, sessionData);

    return sessionData;
  }

  private getUserMessages(sessionData: SessionData) {
    return sessionData.messages.filter(msg => msg.role === "user");
  }

  private estimateTimeSaved(originalSize: number): number {
    const baseTime = (originalSize / 1024) * 0.3;
    return Math.floor(baseTime * 0.65);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Get compact cache statistics
   */
  getCompactCacheStats() {
    return this.compactCache.getStats();
  }

  /**
   * Clear compact cache
   */
  clearCompactCache(sessionId?: string) {
    return this.compactCache.clearCache(sessionId);
  }

  /**
   * Get signal dictionary statistics
   */
  getSignalStats() {
    return this.signalMatcher.getStats();
  }

  /**
   * Close all resources
   */
  close() {
    this.signalMatcher.close();
    this.signalExtractor.close();
    this.confidenceUpdater.close();
    this.clusterer.close();
    this.ruleGenerator.close();
    this.db.close();
  }
}
