#!/usr/bin/env node
/**
 * AutoImprove MCP Server - TypeScript implementation
 *
 * FastMCP-based server providing tools and resources for AutoImprove.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { initStorage, getStorageInfo, loadConfig } from "./storage/init.js";
import { RuleIndexManager } from "./storage/rule-index.js";
import { RuleContentManager } from "./storage/rule-content.js";
import { RuleVersionControl } from "./storage/rule-version.js";
import { SessionAnalysisTracker } from "./storage/session-analysis-tracker.js";
import { SessionAnalyzer } from "./core/session-analyzer.js";
import { RuleGenerator } from "./core/rule-generator.js";
import { HybridRuleGenerator } from "./core/hybrid-rule-generator.js";
import { RuleMatcher } from "./core/rule-matcher.js";
import { RuleQualityController } from "./core/rule-quality.js";
import { AdaptiveConfidenceCalculator } from "./core/adaptive-confidence.js";
import { EnhancedSceneDetector } from "./core/enhanced-scene-detector.js";
import { ClaudeIndexExporter } from "./tools/export-rules-to-claude.js";
import { RuleUsageStatsAnalyzer } from "./core/rule-usage-stats.js";
import { SignalDictionaryDB } from "./storage/signal-dictionary-db.js";
import { SignalMatcher } from "./core/signal-matcher.js";
import { LLMSignalExtractor } from "./core/llm-signal-extractor.js";
import { BayesianConfidenceUpdater } from "./core/bayesian-confidence-updater.js";
import { PatternClusterer } from "./core/pattern-clusterer.js";
import { LLMRuleGenerator } from "./core/llm-rule-generator.js";
import { AdaptiveSessionAnalyzer } from "./core/adaptive-session-analyzer.js";
import { logger } from "./core/logger.js";
import { createScene, PatternType } from "./core/models.js";
import { existsSync } from "fs";
import { SERVER_INSTRUCTIONS, SERVER_INSTRUCTIONS_NO_STORAGE, SERVER_INSTRUCTIONS_RICH, SERVER_INSTRUCTIONS_BASIC, SERVER_INSTRUCTIONS_EMPTY } from "./mcp-instructions.js";
import { ProactiveRuleResourceProvider } from "./resources/proactive-rules.js";

// ============================================================================
// Initialization
// ============================================================================

/**
 * Parse comma-separated string into trimmed, non-empty array.
 * Returns undefined if input is falsy or results in empty array.
 */
function parseCommaSeparated(input: string | undefined): string[] | undefined {
  if (!input) return undefined;
  const items = input.split(",")
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return items.length > 0 ? items : undefined;
}

let indexManager: RuleIndexManager;
let contentManager: RuleContentManager;
let versionControl: RuleVersionControl;
let analysisTracker: SessionAnalysisTracker;
let proactiveRuleProvider: ProactiveRuleResourceProvider;
let analyzer: SessionAnalyzer;
let generator: RuleGenerator;
let hybridGenerator: HybridRuleGenerator;
let matcher: RuleMatcher;
let qualityController: RuleQualityController;
let adaptiveConfidence: AdaptiveConfidenceCalculator;
let sceneDetector: EnhancedSceneDetector;
let claudeIndexExporter: ClaudeIndexExporter;
let statsAnalyzer: RuleUsageStatsAnalyzer;
// Adaptive pattern recognition components (initialized but reserved for future use)
// Reserved for future adaptive pattern recognition features
let _signalDB: SignalDictionaryDB;
let _signalMatcher: SignalMatcher;
let _signalExtractor: LLMSignalExtractor;
let _confidenceUpdater: BayesianConfidenceUpdater;
let _patternClusterer: PatternClusterer;
let _llmRuleGenerator: LLMRuleGenerator;
let _adaptiveAnalyzer: AdaptiveSessionAnalyzer;

function ensureInitialized() {
  if (!indexManager) {
    // Initialize storage if needed
    initStorage();

    const config = loadConfig();

    indexManager = new RuleIndexManager();
    contentManager = new RuleContentManager();
    versionControl = new RuleVersionControl();
    analysisTracker = new SessionAnalysisTracker();
    analyzer = new SessionAnalyzer();
    generator = new RuleGenerator();
    hybridGenerator = new HybridRuleGenerator();
    matcher = new RuleMatcher(indexManager, config.rule_matching.max_results, config.rule_matching.min_confidence);
    qualityController = new RuleQualityController();
    adaptiveConfidence = new AdaptiveConfidenceCalculator();
    sceneDetector = new EnhancedSceneDetector();
    claudeIndexExporter = new ClaudeIndexExporter(indexManager, contentManager);
    statsAnalyzer = new RuleUsageStatsAnalyzer(indexManager, contentManager, adaptiveConfidence);
    proactiveRuleProvider = new ProactiveRuleResourceProvider(indexManager, contentManager, sceneDetector);

    // Initialize adaptive pattern recognition components
    _signalDB = new SignalDictionaryDB();
    _signalMatcher = new SignalMatcher();
    _signalExtractor = new LLMSignalExtractor();
    _confidenceUpdater = new BayesianConfidenceUpdater();
    _patternClusterer = new PatternClusterer();
    _llmRuleGenerator = new LLMRuleGenerator();
    _adaptiveAnalyzer = new AdaptiveSessionAnalyzer();

    logger.info("server", "AutoImprove MCP Server initialized");
  }
}

// ============================================================================
// MCP Server Setup
// ============================================================================

/**
 * Select appropriate instructions based on rule quality.
 * Learned from CodeGraph's dynamic instruction pattern.
 */
function selectInstructions(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) return SERVER_INSTRUCTIONS_EMPTY;

  const indexPath = `${homeDir}/.autoimprove/rules/index.json`;
  if (!existsSync(indexPath)) {
    return SERVER_INSTRUCTIONS_EMPTY;
  }

  try {
    // Lazy initialize to check rule quality
    ensureInitialized();

    const allRules = indexManager.listRules();
    const highConfidenceRules = allRules.filter(r => r.confidence >= 0.7);

    if (highConfidenceRules.length >= 5) {
      return SERVER_INSTRUCTIONS_RICH;
    } else if (allRules.length > 0) {
      return SERVER_INSTRUCTIONS_BASIC;
    } else {
      return SERVER_INSTRUCTIONS_EMPTY;
    }
  } catch (error) {
    logger.warn("instruction-selection", `Failed to select instructions: ${error}`);
    return SERVER_INSTRUCTIONS_BASIC; // Fallback to basic
  }
}

const server = new Server(
  {
    name: "autoimprove-core",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
    // Dynamic instructions based on rule quality
    instructions: selectInstructions(),
  }
);

// ============================================================================
// Tools
// =======================================================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "analyze_session",
        description: "Analyze a Claude Code session file and detect patterns. Supports incremental analysis.",
        inputSchema: {
          type: "object",
          properties: {
            session_file_path: {
              type: "string",
              description: "Path to session JSONL file",
            },
            incremental: {
              type: "boolean",
              description: "Use incremental analysis (only analyze new content since last run). Default: true",
            },
            force_reanalyze: {
              type: "boolean",
              description: "Force full reanalysis even if cached. Default: false",
            },
          },
          required: ["session_file_path"],
        },
      },
      {
        name: "generate_rules",
        description: "Generate rules from detected patterns (supports basic and enhanced generation)",
        inputSchema: {
          type: "object",
          properties: {
            patterns_json: {
              type: "string",
              description: "JSON string of patterns array",
            },
            scene_json: {
              type: "string",
              description: "Optional JSON string of scene context",
            },
            use_llm_enhancement: {
              type: "boolean",
              description: "Enable LLM-based content enhancement (Phase 2) - requires ANTHROPIC_API_KEY",
            },
            extract_code_examples: {
              type: "boolean",
              description: "Extract code examples from session tool calls (Phase 3)",
            },
            session_dir: {
              type: "string",
              description: "Path to session files directory (default: ~/.claude/sessions)",
            },
            max_examples: {
              type: "number",
              description: "Maximum number of code examples per rule (default: 3)",
            },
          },
          required: ["patterns_json"],
        },
      },
      {
        name: "search_knowledge",
        description: `Search rules by scene, keywords, or ID. Use this to find applicable coding patterns before implementing.

Usage patterns:
1. Search by scene (tech stack + functional domain):
   scene_json: '{"tech":["react","typescript"],"functional":["auth","api"],"business":[]}'

2. Search by keywords:
   keywords: "validation,async,error-handling"

3. Search by specific rule ID:
   rule_id: "RULE-010"

4. Combined scene + keywords:
   scene_json: '{"tech":["python"],"functional":["database"]}', keywords: "orm,query"

Scene structure:
- tech: Array of technology keywords (e.g., ["react","vue","python","typescript","java"])
- functional: Array of functional domain keywords (e.g., ["auth","api","database","validation","testing"])
- business: Array of business domain keywords (e.g., ["payment","analytics","user-management"])
- All fields are optional arrays; empty arrays [] are valid

Auto-feedback: When rules match, automatically records "used" feedback unless skip_feedback=true`,
        inputSchema: {
          type: "object",
          properties: {
            scene_json: {
              type: "string",
              description: `JSON string representing the coding scene. Structure: {"tech":[],"functional":[],"business":[]}. Examples:
- React auth: '{"tech":["react","typescript"],"functional":["auth"]}'
- Python API: '{"tech":["python"],"functional":["api","validation"]}'
- General validation: '{"tech":[],"functional":["validation"]}'
- Empty scene: '{"tech":[],"functional":[],"business":[]}'

All fields are arrays. Null/undefined/non-array values are normalized to []. Scene detection is case-insensitive.`,
            },
            keywords: {
              type: "string",
              description: `Comma-separated keywords to match against rule content. Examples:
- "jwt,token,authentication"
- "async,promise,error-handling"
- "sql,injection,sanitize"

Keywords are matched against rule descriptions, titles, and content. Use specific technical terms for better results.`,
            },
            rule_id: {
              type: "string",
              description: `Specific rule ID to retrieve. Format: RULE-XXX (e.g., "RULE-010", "RULE-042"). Use this to fetch a single rule's full content when you know the exact ID.`,
            },
            skip_feedback: {
              type: "boolean",
              description: `Set to true to skip automatic "used" feedback recording. Default: false. Only use when browsing rules without applying them (e.g., listing all rules for review). Normal searches should record feedback to improve confidence scores.`,
            },
          },
        },
      },
      {
        name: "update_rules",
        description: "Update an existing rule",
        inputSchema: {
          type: "object",
          properties: {
            rule_id: {
              type: "string",
              description: "ID of rule to update",
            },
            updates_json: {
              type: "string",
              description: "JSON string of fields to update",
            },
          },
          required: ["rule_id", "updates_json"],
        },
      },
      {
        name: "list_scenes",
        description: "List all known scenes from rules and sessions",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "clear_cache",
        description: "Clear analysis cache for a session or all sessions",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Optional session ID to clear. If omitted, clears all cache.",
            },
          },
        },
      },
      {
        name: "cache_stats",
        description: "Get cache statistics and health info",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "compact_cache_stats",
        description: "Get compact cache statistics (performance metrics, hit rate, savings)",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "clear_compact_cache",
        description: "Clear compact cache for a session or all sessions",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Optional session ID to clear. If omitted, clears all compact caches.",
            },
          },
        },
      },
      {
        name: "health_check",
        description: "Check server health and storage status",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "assess_rule_quality",
        description: "Assess the quality of a rule (clarity, specificity, actionability)",
        inputSchema: {
          type: "object",
          properties: {
            rule_id: {
              type: "string",
              description: "ID of rule to assess",
            },
          },
          required: ["rule_id"],
        },
      },
      {
        name: "detect_rule_conflicts",
        description: "Detect conflicts between a new rule and existing rules",
        inputSchema: {
          type: "object",
          properties: {
            rule_id: {
              type: "string",
              description: "ID of rule to check for conflicts",
            },
          },
          required: ["rule_id"],
        },
      },
      {
        name: "get_rule_version_history",
        description: "Get version history for a rule",
        inputSchema: {
          type: "object",
          properties: {
            rule_id: {
              type: "string",
              description: "ID of rule",
            },
          },
          required: ["rule_id"],
        },
      },
      {
        name: "rollback_rule",
        description: "Rollback a rule to a previous version",
        inputSchema: {
          type: "object",
          properties: {
            rule_id: {
              type: "string",
              description: "ID of rule",
            },
            version: {
              type: "number",
              description: "Version number to rollback to",
            },
          },
          required: ["rule_id", "version"],
        },
      },
      {
        name: "record_feedback",
        description: "Record feedback for a rule (used, ignored, corrected, disabled)",
        inputSchema: {
          type: "object",
          properties: {
            rule_id: {
              type: "string",
              description: "ID of rule",
            },
            feedback_type: {
              type: "string",
              enum: ["used", "ignored", "corrected", "disabled"],
              description: "Type of feedback",
            },
            user_rating: {
              type: "number",
              description: "Optional user rating (1-5)",
            },
            context: {
              type: "string",
              description: "Optional context information",
            },
          },
          required: ["rule_id", "feedback_type"],
        },
      },
      {
        name: "get_feedback_stats",
        description: "Get feedback statistics for a rule or all rules",
        inputSchema: {
          type: "object",
          properties: {
            rule_id: {
              type: "string",
              description: "Optional rule ID. If omitted, returns stats for all rules",
            },
          },
        },
      },
      {
        name: "detect_scene_enhanced",
        description: "Detect scene with enhanced multi-dimensional analysis",
        inputSchema: {
          type: "object",
          properties: {
            user_input: {
              type: "string",
              description: "User input text",
            },
            file_paths: {
              type: "string",
              description: "Comma-separated file paths",
            },
            project_root: {
              type: "string",
              description: "Project root directory",
            },
          },
        },
      },
      {
        name: "mark_session_analyzed",
        description: "Mark a session as analyzed to avoid redundant processing",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session ID (UUID from filename)",
            },
            session_file_path: {
              type: "string",
              description: "Full path to session file",
            },
            patterns_found: {
              type: "number",
              description: "Number of patterns found",
            },
            rules_generated: {
              type: "number",
              description: "Number of rules generated",
            },
            analysis_mode: {
              type: "string",
              description: "Analysis mode: 'standard' or 'consolidated'",
            },
            success: {
              type: "boolean",
              description: "Whether analysis was successful",
            },
            error_message: {
              type: "string",
              description: "Error message if analysis failed",
            },
          },
          required: ["session_id", "session_file_path"],
        },
      },
      {
        name: "get_analysis_status",
        description: "Get analysis status for a session or overall statistics",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Optional session ID. If omitted, returns overall statistics",
            },
          },
        },
      },
      {
        name: "list_unanalyzed_sessions",
        description: "Filter a list of session files to find which ones haven't been analyzed yet",
        inputSchema: {
          type: "object",
          properties: {
            session_file_paths: {
              type: "array",
              items: {
                type: "string",
              },
              description: "Array of session file paths to check",
            },
          },
          required: ["session_file_paths"],
        },
      },
      {
        name: "clear_analysis_record",
        description: "Clear analysis record for a session or all sessions (for re-analysis)",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session ID to clear (mutually exclusive with clear_all)",
            },
            clear_all: {
              type: "boolean",
              description: "Clear all analysis records (mutually exclusive with session_id)",
            },
          },
        },
      },
      {
        name: "check_session_needs_analysis",
        description: "Check if a session needs analysis based on file modification time",
        inputSchema: {
          type: "object",
          properties: {
            session_file_path: {
              type: "string",
              description: "Full path to session file",
            },
          },
          required: ["session_file_path"],
        },
      },
      {
        name: "export_rules_to_claude_md",
        description: "Export top rules to ~/.autoimprove/rules/claude-index.md for automatic loading by Claude",
        inputSchema: {
          type: "object",
          properties: {
            strategy: {
              type: "string",
              enum: ["top-n", "category-balanced"],
              description: "Selection strategy: 'top-n' (by confidence) or 'category-balanced' (recommended)",
            },
            limit: {
              type: "number",
              description: "Maximum number of rules to export (default: 10)",
            },
            min_confidence: {
              type: "number",
              description: "Minimum confidence threshold (default: 0.6)",
            },
          },
          required: ["strategy"],
        },
      },
      {
        name: "clear_all_rules",
        description: "Clear all rules from the knowledge base (use with caution - creates backup)",
        inputSchema: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              description: "Must be true to confirm deletion",
            },
          },
          required: ["confirm"],
        },
      },
      {
        name: "get_rule_usage_stats",
        description: "Get multi-dimensional rule usage statistics with various output formats",
        inputSchema: {
          type: "object",
          properties: {
            dimensions: {
              type: "array",
              items: {
                type: "string",
                enum: ["category", "scene", "priority", "time", "top_rules"],
              },
              description: "Statistics ions to include (default: all)",
            },
            start_date: {
              type: "string",
              description: "Start date for time range filter (ISO format: YYYY-MM-DD)",
            },
            end_date: {
              type: "string",
              description: "End date for time range filter (ISO format: YYYY-MM-DD)",
            },
            categories: {
              type: "array",
            items: { type: "string" },
              description: "Filter by specific categories",
            },
            min_feedbacks: {
              type: "number",
              description: "Minimum feedback count for problematic rules analysis (default: 5)",
            },
            top_n: {
              type: "number",
              description: "Number of top rules to return (default: 10)",
            },
            output_format: {
              type: "string",
              enum: ["json", "markdown", "summary"],
              description: "Output format (default: json)",
            },
          },
        },
      },
      {
        name: "view_signal_dictionary",
        description: "List signals with filters (pattern_type, min_confidence, source)",
        inputSchema: {
          type: "object",
          properties: {
            pattern_type: {
              type: "string",
              enum: ["repeated-correction", "anti-pattern", "preference", "performance", "security"],
              description: "Filter by pattern type",
            },
            min_confidence: {
              type: "number",
              description: "Minimum confidence threshold (default: 0.0)",
            },
            source: {
              type: "string",
              enum: ["seed", "llm-extracted", "manual"],
              description: "Filter by signal source",
            },
            limit: {
              type: "number",
              description: "Maximum number of signals to return (default: 100)",
            },
          },
        },
      },
      {
        name: "add_signal_manually",
        description: "Add signal to dictionary",
        inputSchema: {
          type: "object",
          properties: {
            signal_text: {
              type: "string",
              description: "Signal text/phrase",
            },
            pattern_type: {
              type: "string",
              enum: ["repeated-correction", "anti-pattern", "preference", "performance", "security"],
              description: "Pattern type this signal indicates",
            },
            confidence: {
              type: "number",
              description: "Initial confidence (0.0-1.0, default: 0.5)",
            },
            context: {
              type: "string",
              description: "Optional context or notes",
            },
          },
          required: ["signal_text", "pattern_type"],
        },
      },
      {
        name: "update_signal_confidence",
        description: "Manually update signal confidence",
        inputSchema: {
          type: "object",
          properties: {
            signal_id: {
              type: "string",
              description: "Signal ID",
            },
            new_confidence: {
              type: "number",
              description: "New confidence value (0.0-1.0)",
            },
            reason: {
              type: "string",
              description: "Reason for update",
            },
          },
          required: ["signal_id", "new_confidence"],
        },
      },
      {
        name: "extract_signals_from_session",
        description: "Extract new signals from session's unmatched content",
        inputSchema: {
          type: "object",
          properties: {
            session_file_path: {
              type: "string",
              description: "Path to session JSONL file",
            },
            min_confidence_threshold: {
              type: "number",
              description: "Minimum confidence for extracted signals (default: 0.6)",
            },
          },
          required: ["session_file_path"],
        },
      },
      {
        name: "view_labeled_content",
        description: "View labeled content by session/pattern_type",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Filter by session ID",
            },
            pattern_type: {
              type: "string",
              enum: ["repeated-correction", "anti-pattern", "preference", "performance", "security"],
              description: "Filter by pattern type",
            },
            limit: {
              type: "number",
              description: "Maximum number of records to return (default: 50)",
            },
          },
        },
      },
      {
        name: "trigger_clustering",
        description: "Cluster labeled content for a session",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session ID to cluster",
            },
            min_cluster_size: {
              type: "number",
              description: "Minimum cluster size (default: 2)",
            },
            min_confidence: {
              type: "number",
              description: "Minimum confidence for clustering (default: 0.6)",
            },
          },
          required: ["session_id"],
        },
      },
      {
        name: "generate_rules_from_clusters",
        description: "Generate rules from clusters",
        inputSchema: {
          type: "object",
          properties: {
            session_id: {
              type: "string",
              description: "Session ID with clusters",
            },
            min_cluster_quality: {
              type: "number",
              description: "Minimum cluster quality score (default: 0.7)",
            },
            min_occurrences: {
              type: "number",
              description: "Minimum occurrences per cluster (default: 2)",
            },
          },
          required: ["session_id"],
        },
      },
      {
        name: "get_signal_stats",
        description: "Get signal dictionary statistics",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    ensureInitialized();

    switch (request.params.name) {
      case "analyze_session":
        return await handleAnalyzeSession(request.params.arguments);

      case "generate_rules":
        return await handleGenerateRules(request.params.arguments);

      case "search_knowledge":
        return await handleSearchKnowledge(request.params.arguments);

      case "update_rules":
        return await handleUpdateRules(request.params.arguments);

      case "list_scenes":
        return await handleListScenes();

      case "clear_cache":
        return await handleClearCache(request.params.arguments);

      case "cache_stats":
        return await handleCacheStats();

      case "compact_cache_stats":
        return await handleCompactCacheStats();

      case "clear_compact_cache":
        return await handleClearCompactCache(request.params.arguments);

      case "health_check":
        return await handleHealthCheck();

      case "assess_rule_quality":
        return await handleAssessRuleQuality(request.params.arguments);

      case "detect_rule_conflicts":
        return await handleDetectRuleConflicts(request.params.arguments);

      case "get_rule_version_history":
        return await handleGetRuleVersionHistory(request.params.arguments);

      case "rollback_rule":
        return await handleRollbackRule(request.params.arguments);

      case "record_feedback":
        return await handleRecordFeedback(request.params.arguments);

      case "get_feedback_stats":
        return await handleGetFeedbackStats(request.params.arguments);

      case "detect_scene_enhanced":
        return await handleDetectSceneEnhanced(request.params.arguments);

      case "mark_session_analyzed":
        return await handleMarkSessionAnalyzed(request.params.arguments);

      case "get_analysis_status":
        return await handleGetAnalysisStatus(request.params.arguments);

      case "list_unanalyzed_sessions":
        return await handleListUnanalyzedSessions(request.params.arguments);

      case "clear_analysis_record":
        return await handleClearAnalysisRecord(request.params.arguments);

      case "check_session_needs_analysis":
        return await handleCheckSessionNeedsAnalysis(request.params.arguments);

      case "export_rules_to_claude_md":
        return await handleExportRulesToClaudeMd(request.params.arguments);

      case "clear_all_rules":
        return await handleClearAllRules(request.params.arguments);

      case "get_rule_usage_stats":
        return await handleGetRuleUsageStats(request.params.arguments);

      case "view_signal_dictionary":
        return await handleViewSignalDictionary(request.params.arguments);

      case "add_signal_manually":
        return await handleAddSignalManually(request.params.arguments);

      case "update_signal_confidence":
        return await handleUpdateSignalConfidence(request.params.arguments);

      case "extract_signals_from_session":
        return await handleExtractSignalsFromSession(request.params.arguments);

      case "view_labeled_content":
        return await handleViewLabeledContent(request.params.arguments);

      case "trigger_clustering":
        return await handleTriggerClustering(request.params.arguments);

      case "generate_rules_from_clusters":
        return await handleGenerateRulesFromClusters(request.params.arguments);

      case "get_signal_stats":
        return await handleGetSignalStats();

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
});

// ============================================================================
// Tool Handlers
// ============================================================================

async function handleAnalyzeSession(args: any) {
  const sessionFilePath = args.session_file_path as string;

  if (!existsSync(sessionFilePath)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Session file not found: ${sessionFilePath}`,
          }),
        },
      ],
    };
  }

  const patterns = analyzer.analyzeSession(sessionFilePath, {
    incremental: args.incremental !== false,
    forceReanalyze: args.force_reanalyze === true,
  });
  const patternsData = patterns.map((p) => ({
    type: p.type,
    description: p.description,
    occurrences: p.occurrences,
    first_seen: p.first_seen,
    last_seen: p.last_seen,
    confidence: p.confidence,
    category: p.category,
    priority: p.priority,
    keywords: p.keywords,
  }));

  const sessionId = sessionFilePath.split("/").pop()?.replace(".jsonl", "") || "unknown";

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          session_id: sessionId,
          patterns_count: patterns.length,
          patterns: patternsData,
          analysis_mode: args.force_reanalyze ? "full" : args.incremental !== false ? "incremental" : "full",
        }),
      },
    ],
  };
}

async function handleGenerateRules(args: any) {
  const patternsJson = args.patterns_json as string;
  const sceneJson = args.scene_json as string | undefined;
  const useLLMEnhancement = args.use_llm_enhancement === true;
  const extractCodeExamples = args.extract_code_examples !== false; // Default true
  const sessionDir = args.session_dir as string | undefined;
  const maxExamples = args.max_examples as number | undefined;

  // Validate input
  if (!patternsJson || patternsJson === "undefined") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "patterns_json is required and cannot be undefined",
          }),
        },
      ],
    };
  }

  let patternsData;
  try {
    patternsData = JSON.parse(patternsJson);
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Invalid patterns_json: ${error.message}`,
          }),
        },
      ],
    };
  }

  if (!Array.isArray(patternsData)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "patterns_json must be an array",
          }),
        },
      ],
    };
  }

  const patterns = patternsData.map((p: any) => ({
    type: p.type as PatternType,
    description: p.description,
    occurrences: p.occurrences,
    first_seen: p.first_seen,
    last_seen: p.last_seen,
    confidence: p.confidence || 0,
    category: p.category,
    priority: p.priority,
    keywords: p.keywords || [],
  }));

  const scene = sceneJson ? JSON.parse(sceneJson) : undefined;

  const nextIdNum = parseInt(indexManager.getNextRuleId().split("-")[1], 10);

  // Choose generation strategy based on options
  const useEnhanced = useLLMEnhancement || extractCodeExamples;
  let rules: Array<{ indexEntry: any; content: any }>;

  if (useEnhanced) {
    // Use hybrid generator (Phase 2-4)
    logger.info("generate_rules", `Using enhanced generation: LLM=${useLLMEnhancement}, CodeExamples=${extractCodeExamples}`);

    rules = await hybridGenerator.batchGenerateEnhancedRules(
      patterns,
      nextIdNum,
      scene,
      {
        useLLMEnhancement,
        extractCodeExamples,
        sessionDir,
        maxExamples,
      }
    );
  } else {
    // Use basic generator (Phase 1 only - backward compatibility)
    logger.info("generate_rules", "Using basic generation (fast mode)");
    rules = generator.batchGenerateRules(patterns, nextIdNum, scene);
  }

  const generatedIds: string[] = [];
  for (const { indexEntry, content } of rules) {
    indexManager.addRule(indexEntry);
    contentManager.saveContent(content);
    generatedIds.push(indexEntry.id);
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          rules_count: generatedIds.length,
          rule_ids: generatedIds,
          generation_mode: useEnhanced ? "enhanced" : "basic",
          llm_enhancement: useLLMEnhancement,
          code_examples_extracted: extractCodeExamples,
        }),
      },
    ],
  };
}

async function handleSearchKnowledge(args: any) {
  const sceneJson = args.scene_json as string | undefined;
  const keywords = args.keywords as string | undefined;
  const ruleId = args.rule_id as string | undefined;
  const skipFeedback = args.skip_feedback === true;

  // Search by ID
  if (ruleId) {
    const rule = indexManager.getRule(ruleId);
    if (rule) {
      const content = contentManager.loadContent(ruleId);

      // 🆕 Auto-record feedback when rule is queried
      if (!skipFeedback) {
        adaptiveConfidence.recordFeedback({
          rule_id: ruleId,
          timestamp: new Date().toISOString(),
          feedback_type: "used",
          context: "rule_query_by_id",
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              matches_count: 1,
              matches: [
                {
                  rule: rule,
                  content: content ? contentManager.toMarkdown(content) : null,
                },
              ],
            }),
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Rule not found: ${ruleId}`,
            }),
          },
        ],
      };
    }
  }

  // Search by scene
  if (sceneJson) {
    const parsedScene = JSON.parse(sceneJson);
    const scene = createScene(parsedScene); // Normalize to ensure all fields exist
    const kwList = parseCommaSeparated(keywords);
    const matches = matcher.matchRules(scene, kwList);

    // 🆕 Auto-record feedback for matched rules
    if (!skipFeedback && matches.length > 0) {
      const techStr = (scene.tech || []).join(",") || "none";
      const funcStr = (scene.functional || []).join(",") || "none";
      const sceneContext = `scene:${techStr}/${funcStr}`;
      const keywordContext = kwList ? `:keywords:${kwList.join(",")}` : "";

      for (const match of matches) {
        adaptiveConfidence.recordFeedback({
          rule_id: match.rule.id,
          timestamp: new Date().toISOString(),
          feedback_type: "used",
          context: `${sceneContext}${keywordContext}:relevance:${match.relevance_score.toFixed(2)}`,
        });
      }

      logger.info("feedback", `Auto-recorded ${matches.length} rule queries`, {
        scene: sceneContext,
        keywords: kwList,
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            matches_count: matches.length,
            matches: matches.map((m) => ({
              rule: m.rule,
              relevance: m.relevance_score,
              reason: m.match_reason,
            })),
          }),
        },
      ],
    };
  }

  // List all rules (no feedback recording for list-all queries)
  const rules = indexManager.listRules();
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          matches_count: rules.length,
          matches: rules.map((r) => ({ rule: r })),
        }),
      },
    ],
  };
}

async function handleUpdateRules(args: any) {
  const ruleId = args.rule_id as string;
  const updatesJson = args.updates_json as string;

  const updates = JSON.parse(updatesJson);

  // Update index
  if (["priority", "confidence", "scenes", "keywords"].some((k) => k in updates)) {
    const indexUpdates: any = {};
    for (const key of ["priority", "confidence", "scenes", "keywords"]) {
      if (key in updates) {
        indexUpdates[key] = updates[key];
      }
    }
    indexManager.updateRule(ruleId, indexUpdates);
  }

  // Update content
  if ("content" in updates || "reason" in updates) {
    const content = contentManager.loadContent(ruleId);
    if (content) {
      if ("content" in updates) {
        content.content = updates.content;
      }
      if ("reason" in updates) {
        content.reason = updates.reason;
      }
      contentManager.saveContent(content);
    }
  }

  // Invalidate matcher cache
  matcher.invalidateCache();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          rule_id: ruleId,
        }),
      },
    ],
  };
}

async function handleListScenes() {
  const rules = indexManager.listRules();

  const techCounts: Record<string, number> = {};
  const functionalCounts: Record<string, number> = {};
  const businessCounts: Record<string, number> = {};

  for (const rule of rules) {
    if (rule.scenes) {
      const scene = rule.scenes;

      for (const tech of scene.tech) {
        techCounts[tech] = (techCounts[tech] || 0) + 1;
      }
      for (const func of scene.functional) {
        functionalCounts[func] = (functionalCounts[func] || 0) + 1;
      }
      for (const biz of scene.business) {
        businessCounts[biz] = (businessCounts[biz] || 0) + 1;
      }
    }
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          tech: techCounts,
          functional: functionalCounts,
          business: businessCounts,
        }),
      },
    ],
  };
}

async function handleHealthCheck() {
  const storageInfo = getStorageInfo();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          status: "healthy",
          storage: storageInfo,
        }),
      },
    ],
  };
}

async function handleClearCache(args: any) {
  const sessionId = args.session_id as string | undefined;

  if (sessionId) {
    analyzer.clearCache(sessionId);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            message: `Cache cleared for session ${sessionId}`,
          }),
        },
      ],
    };
  } else {
    // Clear all cache - need to access cache manager through analyzer
    const stats = analyzer.getCacheStats();
    const count = stats.total_sessions;

    // Clear by recreating the cache manager
    analyzer.clearCache("_all_");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            message: `Cleared cache for ${count} session(s)`,
            cleared_count: count,
          }),
        },
      ],
    };
  }
}

async function handleCacheStats() {
  const stats = analyzer.getCacheStats();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          cache: stats,
        }),
      },
    ],
  };
}

async function handleCompactCacheStats() {
  const stats = analyzer.getCompactCacheStats();

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          compact_cache: stats,
          summary: {
            total_requests: stats.total_requests,
            hit_rate: `${(stats.hit_rate * 100).toFixed(1)}%`,
            time_saved: `${(stats.time_saved_ms / 1000).toFixed(2)}s`,
            bytes_saved: formatBytes(stats.bytes_saved),
          }
        }),
      },
    ],
  };
}

async function handleClearCompactCache(args: any) {
  const sessionId = args.seon_id as string | undefined;

  const result = analyzer.clearCompactCache(sessionId);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: result.errors.length === 0,
          cleared: result.cleared,
          errors: result.errors,
          message: sessionId
            ? `Cleared compact cache for session ${sessionId}`
            : `Cleared ${result.cleared} compact cache file(s)`,
        }),
      },
    ],
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function handleAssessRuleQuality(args: any) {
  const ruleId = args.rule_id as string;

  const rule = indexManager.getRule(ruleId);
  if (!rule) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Rule not found: ${ruleId}`,
          }),
        },
      ],
    };
  }

  const content = contentManager.loadContent(ruleId);
  if (!content) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Rule content: ${ruleId}`,
          }),
        },
      ],
    };
  }

  const qualityScore = qualityController.assessQuality(content, rule);
  logger.logQualityAssessment(ruleId, qualityScore.overall, qualityScore.issues);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          rule_id: ruleId,
          quality: qualityScore,
        }),
      },
    ],
  };
}

async function handleDetectRuleConflicts(args: any) {
  const ruleId = args.rule_id as string;

  const rule = indexManager.getRule(ruleId);
  if (!rule) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Rule not found: ${ruleId}`,
          }),
        },
      ],
    };
  }

  const content = contentManager.loadContent(ruleId);
  if (!content) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Rule content not found: ${ruleId}`,
          }),
        },
      ],
    };
  }

  // Get all existing rules
  const allRules = indexManager.listRules();
  const existingRules = allRules
    .filter((r) => r.id !== ruleId)
    .map((r) => ({
      index: r,
      content: contentManager.loadContent(r.id)!,
    }))
    .filter((r) => r.content !== null);

  const conflicts = qualityController.detectConflicts(content, existingRules);
  const maxSeverity = conflicts.length > 0 ? conflicts[0].severity : "none";
  logger.logConflictDetection(ruleId, conflicts.length, maxSeverity);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          rule_id: ruleId,
          conflicts_count: conflicts.length,
          conflicts: conflicts,
        }),
      },
    ],
  };
}

async function handleGetRuleVersionHistory(args: any) {
  const ruleId = args.rule_id as string;

  const versions = versionControl.getVersionHistory(ruleId);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          rule_id: ruleId,
          versions_count: versions.length,
          versions: versions,
        }),
      },
    ],
  };
}

async function handleRollbackRule(args: any) {
  const ruleId = args.rule_id as string;
  const version = args.version as number;

  try {
    const newVersion = versionControl.rollback(ruleId, version);

    if (newVersion) {
      // Update the index and content with rolled back version
      const rule = indexManager.getRule(ruleId);
      if (rule) {
        indexManager.updateRule(ruleId, {
          confidence: newVersion.content.metadata.confidence,
        });
        contentManager.saveContent(newVersion.content);
      }

      logger.info("version-control", `Rolled back rule ${ruleId} to version ${version}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            rule_id: ruleId,
            rolled_back_to: version,
            new_version: newVersion?.version,
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("version-control", `Failed to rollback rule ${ruleId}`, error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleRecordFeedback(args: any) {
  const ruleId = args.rule_id as string;
  const feedbackType = args.feedback_type as "used" | "ignored" | "corrected" | "disabled";
  const userRating = args.user_rating as number | undefined;
  const context = args.context as string | undefined;

  const feedback = {
    rule_id: ruleId,
    timestamp: new Date().toISOString(),
    feedback_type: feedbackType,
    user_rating: userRating,
    context: context,
  };

  adaptiveConfidence.recordFeedback(feedback);
  logger.info("feedback", `Recorded ${feedbackType} feedback for rule ${ruleId}`, {
    rating: userRating,
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          feedback: feedback,
        }),
      },
    ],
  };
}

async function handleGetFeedbackStats(args: any) {
  const ruleId = args.rule_id as string | undefined;

  const stats = adaptiveConfidence.getFeedbackStats(ruleId);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          rule_id: ruleId || "all",
          stats: stats,
        }),
      },
    ],
  };
}

async function handleDetectSceneEnhanced(args: any) {
  const userInput = args.user_input as string | undefined;
  const filePaths = args.file_paths as string | undefined;
  const projectRoot = args.project_root as string | undefined;

  const context = {
    userInput,
    filePaths: parseCommaSeparated(filePaths),
    projectRoot,
  };

  const sceneWeights = sceneDetector.detectMultiScenes(context);

  logger.info("scene-detection", `Detected ${sceneWeights.length} scenes`, {
    top_scene: sceneWeights[0]
      ? `${sceneWeights[0].scene.tech.join(",")}/${sceneWeights[0].scene.functional.join(",")}`
      : "none",
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          scenes: sceneWeights.map((sw) => ({
            scene: sw.scene,
            weight: sw.weight,
            reasons: sw.reasons,
          })),
        }),
      },
    ],
  };
}

async function handleMarkSessionAnalyzed(args: any) {
  const sessionId = args.session_id as string;
  const sessionFilePath = args.session_file_path as string;
  const patternsFound = args.patterns_found as number;
  const rulesGenerated = args.rules_generated as number;
  const analysisMode = (args.analysis_mode as "standard" | "consolidated") || "standard";
  const success = args.success !== false;
  const errorMessage = args.error_message as string | undefined;
  const incrementalAnalysis = args.incremental_analysis as boolean | undefined;
  const previousPatterns = args.previous_patterns as number | undefined;
  const previousRules = args.previous_rules as number | undefined;

  if (!sessionId || !sessionFilePath) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "session_id and session_file_path are required",
          }),
        },
      ],
    };
  }

  // Get file stats
  let fileMtime = 0;
  let fileSize = 0;
  try {
    const { existsSync, statSync } = await import("fs");
    if (existsSync(sessionFilePath)) {
      const stats = statSync(sessionFilePath);
      fileMtime = stats.mtimeMs;
      fileSize = stats.size;
    }
  } catch (error) {
    // If we can't get file stats, use current time
    fileMtime = Date.now();
  }

  analysisTracker.markAnalyzed({
    session_id: sessionId,
    session_file_path: sessionFilePath,
    analyzed_at: new Date().toISOString(),
    file_mtime: fileMtime,
    file_size: fileSize,
    patterns_found: patternsFound || 0,
    rules_generated: rulesGenerated || 0,
    analysis_mode: analysisMode,
    success,
    error_message: errorMessage,
    incremental_analysis: incrementalAnalysis,
    previous_patterns: previousPatterns,
    previous_rules: previousRules,
  });

  logger.info("session-analysis", `Marked session ${sessionId} as analyzed`, {
    patterns: patternsFound,
    rules: rulesGenerated,
    mode: analysisMode,
    incremental: incrementalAnalysis || false,
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          session_id: sessionId,
          marked_at: new Date().toISOString(),
          file_mtime: fileMtime,
          file_size: fileSize,
        }),
      },
    ],
  };
}

async function handleGetAnalysisStatus(args: any) {
  const sessionId = args.session_id as string | undefined;

  if (sessionId) {
    // Get status for specific session
    const record = analysisTracker.getRecord(sessionId);
    const isAnalyzed = analysisTracker.isAnalyzed(sessionId);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            session_id: sessionId,
            is_analyzed: isAnalyzed,
            record: record || null,
          }),
        },
      ],
    };
  } else {
    // Get overall statistics
    const stats = analysisTracker.getStats();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            stats,
          }),
        },
      ],
    };
  }
}

async function handleListUnanalyzedSessions(args: any) {
  const sessionFilePaths = args.session_file_paths as string[];

  if (!sessionFilePaths || !Array.isArray(sessionFilePaths)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "session_file_paths array is required",
          }),
        },
      ],
    };
  }

  // Extract session IDs from file paths
  const sessionIds = sessionFilePaths.map((path) => {
    const match = path.match(/([a-f0-9-]{36})\.jsonl$/);
    return match ? match[1] : null;
  }).filter((id): id is string => id !== null);

  const unanalyzedIds = analysisTracker.filterUnanalyzed(sessionIds);

  // Map back to full paths
  const unanalyzedPaths = sessionFilePaths.filter((path) => {
    const match = path.match(/([a-f0-9-]{36})\.jsonl$/);
    return match && unanalyzedIds.includes(match[1]);
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          total_sessions: sessionFilePaths.length,
          analyzed_count: sessionFilePaths.length - unanalyzedPaths.length,
          unanalyzed_count: unanalyzedPaths.length,
          unanalyzed_sessions: unanalyzedPaths,
        }),
      },
    ],
  };
}

async function handleClearAnalysisRecord(args: any) {
  const sessionId = args.session_id as string | undefined;
  const clearAll = args.clear_all === true;

  if (clearAll) {
    analysisTracker.clearAll();
    logger.info("session-analysis", "Cleared all analysis records");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            message: "All analysis records cleared",
          }),
        },
      ],
    };
  } else if (sessionId) {
    const cleared = analysisTracker.clearRecord(sessionId);

    if (cleared) {
      logger.info("session-analysis", `Cleared analysis record for session ${sessionId}`);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              session_id: sessionId,
              message: "Analysis record cleared",
            }),
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `No analysis record found for session ${sessionId}`,
            }),
          },
        ],
      };
    }
  } else {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "Either session_id or clear_all=true is required",
          }),
        },
      ],
    };
  }
}

async function handleCheckSessionNeedsAnalysis(args: any) {
  const sessionFilePath = args.session_file_path as string;

  if (!sessionFilePath) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "session_file_path is required",
          }),
        },
      ],
    };
  }

  // Extract session ID
  const match = sessionFilePath.match(/([a-f0-9-]{36})\.jsonl$/);
  if (!match) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "Invalid session file path format",
          }),
        },
      ],
    };
  }

  const sessionId = match[1];

  // Get current file stats
  try {
    const { existsSync, statSync } = await import("fs");

    if (!existsSync(sessionFilePath)) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "Session file does not exist",
            }),
          },
        ],
      };
    }

    const stats = statSync(sessionFilePath);
    const currentMtime = stats.mtimeMs;
    const currentSize = stats.size;

    // Check if needs analysis
    const checkResult = analysisTracker.checkIfNeedsAnalysis(sessionId, currentMtime, currentSize);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            session_id: sessionId,
            needs_analysis: checkResult.needsAnalysis,
            reason: checkResult.reason,
            is_incremental: checkResult.isIncremental,
            current_mtime: currentMtime,
            current_size: currentSize,
          }),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
      }),
        },
      ],
    };
  }
}

async function handleExportRulesToClaudeMd(args: any) {
  const strategy = args.strategy as "top-n" | "category-balanced";
  const limit = (args.limit as number) || 10;
  const minConfidence = (args.min_confidence as number) || 0.6;

  try {
    const result = claudeIndexExporter.export({
      strategy,
      limit,
      minConfidence,
    });

    logger.info("export", `Exported ${result.rulesExported} rules to claude-index.md`, {
      strategy,
      tokens: result.tokenEstimate,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            path: result.path,
            rules_exported: result.rulesExported,
            token_estimate: result.tokenEstimate,
            strategy,
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("export", "Failed to export rules to claude-index.md", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleClearAllRules(args: any) {
  const confirm = args.confirm as boolean;

  if (!confirm) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "Must set confirm=true to clear all rules",
          }),
        },
      ],
    };
  }

  try {
    const { writeFileSync, readdirSync, unlinkSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");

    const rulesDir = join(homedir(), ".autoimprove", "rules");
    const contentDir = join(rulesDir, "content");
    const indexFile = join(rulesDir, "index.json");
    const claudeIndexFile = join(rulesDir, "claude-index.md");

    let deletedCount = 0;

    // Clear all rule content files
    try {
      const files = readdirSync(contentDir);
      for (const file of files) {
        if (file.endsWith(".md")) {
          unlinkSync(join(contentDir, file));
          deletedCount++;
        }
      }
    } catch (error: any) {
      // Content dir might not exist, that's ok
    }

    // Reset index.json
    writeFileSync(indexFile, JSON.stringify({ version: "1.0", rules: [] }, null, 2));

    // Reset claude-index.md
    const initialContent = `# AutoImprove Learned Rules

> These rules are automatically learned from your coding habits and will match based on your current work context.

---

💡 **Dynamic Matching**: Claude will automatically apply relevant rules based on your current code context.
📊 **Full Rule Library**: Run \`/autoimprove-rules\` to view all rules.
`;
    writeFileSync(claudeIndexFile, initialContent);

    // Clear in-memory index
    indexManager = new RuleIndexManager();
    contentManager = new RuleContentManager();

    logger.info("clear", `Cleared ${deletedCount} rules from knowledge base`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            deleted_count: deletedCount,
            message: "All rules cleared successfully",
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("clear", "Failed to clear rules", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleGetRuleUsageStats(args: any) {
  try {
    const outputFormat = (args.output_format as "json" | "markdown" | "summary") || "json";
    const minFeedbacks = (args.min_feedbacks as number) || 5;
    const topN = (args.top_n as number) || 10;

    // Parse dates if provided
    const startDate = args.start_date ? new Date(args.start_date) : undefined;
    const endDate = args.end_date ? new Date(args.end_date) : undefined;

    // Get statistics
    const stats = statsAnalyzer.getMultiDimensionalStats({
      startDate,
      endDate,
      categories: args.categories,
      minFeedbacks,
      topN,
    });

    logger.info("stats", "Generated rule usage statistics", {
      total_rules: stats.overview.total_rules,
      total_feedbacks: stats.overview.total_feedbacks,
      format: outputFormat,
    });

    // Format output
    let output: string;
    if (outputFormat === "markdown") {
      output = statsAnalyzer.generateReport(stats);
    } else if (outputFormat === "summary") {
      output = statsAnalyzer.generateSummary(stats);
    } else {
      output = JSON.stringify(stats, null, 2);
    }

    return {
      content: [
        {
          type: "text",
          text: output,
        },
      ],
    };
  } catch (error: any) {
    logger.error("stats", "Failed to generate statistics", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleViewSignalDictionary(args: any) {
  const patternType = args.pattern_type as string | undefined;
  const minConfidence = (args.min_confidence as number) || 0.0;
  const limit = (args.limit as number) || 100;

  try {
    const signals = _signalDB.getAllSignals({
      pattern_type: patternType,
      min_confidence: minConfidence,
      limit: limit,
    });

    logger.info("signal-dictionary", `Retrieved ${signals.length} signals`, {
      pattern_type: patternType,
      min_confidence: minConfidence,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            count: signals.length,
            signals: signals,
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("signal-dictionary", "Failed to retrieve signals", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleAddSignalManually(args: any) {
  const signalText = args.signal_text as string;
  const patternType = args.pattern_type as "correction" | "anti-pattern" | "preference" | "performance" | "security";
  const confidence = (args.confidence as number) || 0.5;
  const context = args.context as string | undefined;

  try {
    const now = new Date().toISOString();
    const signalId = _signalDB.addSignal({
      text: signalText,
      language: "en",
      pattern_type: patternType,
      polarity: "neutral",
      confidence: confidence,
      typical_context: context ? [context] : [],
      related_signals: [],
      match_count: 0,
      true_positive: 0,
      false_positive: 0,
      first_seen: now,
      last_seen: now,
      source: "user_added",
      created_at: now,
      updated_at: now,
    });

    // Rebuild signal matcher to include new signal
    _signalMatcher.rebuild();

    logger.info("signal-dictionary", `Added manual signal: ${signalId}`, {
      pattern_type: patternType,
      confidence: confidence,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            signal_id: signalId,
            message: "Signal added successfully",
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("signal-dictionary", "Failed to add signal", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleUpdateSignalConfidence(args: any) {
  const signalId = args.signal_id as string;
  const newConfidence = args.new_confidence as number;
  const reason = args.reason as string | undefined;

  try {
    _signalDB.updateSignalConfidence(parseInt(signalId), newConfidence, reason || "manual_update", {
      reason: reason || "manual_update"
    });

    // Rebuild signal matcher with updated confidence
    _signalMatcher.rebuild();

    logger.info("signal-dictionary", `Updated signal confidence: ${signalId}`, {
      new_confidence: newConfidence,
      reason: reason,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            signal_id: signalId,
            new_confidence: newConfidence,
            message: "Signal confidence updated successfully",
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("signal-dictionary", "Failed to update signal confidence", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleExtractSignalsFromSession(args: any) {
  const sessionFilePath = args.session_file_path as string;
  const minConfidenceThreshold = (args.min_confidence_threshold as number) || 0.6;

  if (!existsSync(sessionFilePath)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Session file not found: ${sessionFilePath}`,
          }),
        },
      ],
    };
  }

  try {
    // Analyze session to get unmatched content
    const result = await _adaptiveAnalyzer.analyzeSession(sessionFilePath, {
      incremental: true,
      enableSignalExtraction: false, // We'll do extraction manually
      enableClustering: false,
      enableRuleGeneration: false,
    });

    // Extract signals from unmatched content (this is simulated for now)
    const unmatchedCount = result.signal_matches.unmatched_messages;

    logger.info("signal-extraction", `Extracting signals from ${unmatchedCount} unmatched messages`, {
      session_file: sessionFilePath,
      min_confidence: minConfidenceThreshold,
    });

    // For now, return the unmatched message count
    // In a real implementation, this would call _signalExtractor.extractSignals()
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            session_file: sessionFilePath,
            unmatched_messages: unmatchedCount,
            new_signals_extracted: 0, // Placeholder
            message: "Signal extraction completed (stub implementation)",
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("signal-extraction", "Failed to extract signals", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleViewLabeledContent(args: any) {
  const sessionId = args.session_id as string | undefined;
  const patternType = args.pattern_type as string | undefined;

  try {
    let labeledContent: any[] = [];

    if (sessionId) {
      labeledContent = _signalDB.getLabeledContentBySession(sessionId);
    } else if (patternType) {
      labeledContent = _signalDB.getLabeledContentByPatternType(patternType);
    }

    logger.info("labeled-content", `Retrieved ${labeledContent.length} labeled content records`, {
      session_id: sessionId,
      pattern_type: patternType,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            count: labeledContent.length,
            labeled_content: labeledContent,
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("labeled-content", "Failed to retrieve labeled content", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleTriggerClustering(args: any) {
  const sessionId = args.session_id as string;
  const minClusterSize = (args.min_cluster_size as number) || 2;
  const minConfidence = (args.min_confidence as number) || 0.6;

  try {
    // Get labeled content for session
    const labeledContent = _signalDB.getLabeledContentBySession(sessionId);

    if (labeledContent.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `No labeled content found for session: ${sessionId}`,
            }),
          },
        ],
      };
    }

    // Filter by confidence
    const filteredContent = labeledContent.filter(lc => lc.confidence >= minConfidence);

    // Perform clustering
    const clusters = _patternClusterer.clusterPatterns(filteredContent);
    const clusterStats = _patternClusterer.getClusterStats(clusters);

    // Filter by minimum cluster size
    const validClusters = clusters.filter(c => c.total_occurrences >= minClusterSize);

    logger.info("clustering", `Created ${validClusters.length} clusters for session ${sessionId}`, {
      total_clusters: clusters.length,
      valid_clusters: validClusters.length,
      min_cluster_size: minClusterSize,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            session_id: sessionId,
            total_clusters: clusters.length,
            valid_clusters: validClusters.length,
            clusters: validClusters,
            statistics: clusterStats,
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("clustering", "Failed to cluster patterns", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleGenerateRulesFromClusters(args: any) {
  const sessionId = args.session_id as string;
  const minClusterQuality = (args.min_cluster_quality as number) || 0.7;
  const minOccurrences = (args.min_occurrences as number) || 2;

  try {
    // Get labeled content for session
    const labeledContent = _signalDB.getLabeledContentBySession(sessionId);

    if (labeledContent.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `No labeled content found for session: ${sessionId}`,
            }),
          },
        ],
      };
    }

    // Perform clustering
    const clusters = _patternClusterer.clusterPatterns(labeledContent);

    // Filter high-quality clusters
    const highQualityClusters = clusters.filter(
      c => c.avg_confidence >= minClusterQuality && c.total_occurrences >= minOccurrences
    );

    if (highQualityClusters.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `No high-quality clusters found (min_quality=${minClusterQuality}, min_occurrences=${minOccurrences})`,
            }),
          },
        ],
      };
    }

    // Generate rules from clusters
    const nextIdNum = parseInt(indexManager.getNextRuleId().split("-")[1], 10);
    const generatedRules = await _llmRuleGenerator.batchGenerateRules(highQualityClusters, nextIdNum);

    // Save generated rules to index and content
    const ruleIds: string[] = [];
    for (const rule of generatedRules) {
      // Convert GeneratedRule to storage format
      const converted = _llmRuleGenerator.convertToStorageFormat(rule);

      indexManager.addRule(converted.indexEntry);

      contentManager.saveContent({
        id: rule.id,
        content: converted.content.content,
        reason: converted.content.reason,
        metadata: converted.content.metadata,
      });

      ruleIds.push(rule.id);
    }

    logger.info("rule-generation", `Generated ${generatedRules.length} rules from ${highQualityClusters.length} clusters`, {
      session_id: sessionId,
      rule_ids: ruleIds,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            session_id: sessionId,
            clusters_used: highQualityClusters.length,
            rules_generated: generatedRules.length,
            rule_ids: ruleIds,
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("rule-generation", "Failed to generate rules from clusters", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

async function handleGetSignalStats() {
  try {
    const stats = _signalMatcher.getStats();

    logger.info("signal-stats", "Retrieved signal dictionary statistics", {
      total_signals: stats.total_patterns,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            statistics: stats,
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("signal-stats", "Failed to retrieve signal statistics", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
    };
  }
}

// ============================================================================
// Resources
// ============================================================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  ensureInitialized();

  // Get proactive rule resources (scene-specific bundles)
  const proactiveResources = proactiveRuleProvider.listResources();

  return {
    resources: [
      // Existing knowledge resources (manual lookup)
      {
        uri: "knowledge://rules/{rule_id}",
        name: "Get rule content",
        description: "Get full rule content as markdown",
        mimeType: "text/markdown",
      },
      {
        uri: "knowledge://lessons/{scene}",
        name: "Get lessons for scene",
        description: "Get all rules applicable to a scene",
        mimeType: "text/markdown",
      },
      // NEW: Proactive rule resources (auto-loaded by Claude Code)
      ...proactiveResources.map(r => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  ensureInitialized();

  const uri = request.params.uri;

  // Handle proactive rule resources (auto-loaded)
  if (uri.startsWith("autoimprove://rules/proactive/")) {
    try {
      const content = await proactiveRuleProvider.readResource(uri);
      return {
        contents: [{
          uri,
          mimeType: "text/markdown",
          text: content,
        }],
      };
    } catch (error: any) {
      logger.error("proactive-rules", `Failed to read resource ${uri}`, error);
      return {
        contents: [{
          uri,
          mimeType: "text/markdown",
          text: `# Error loading rules\n\n${error.message}`,
        }],
      };
    }
  }

  if (uri.startsWith("knowledge://rules/")) {
    const ruleId = uri.replace("knowledge://rules/", "");
    const content = contentManager.loadContent(ruleId);

    if (content) {
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: contentManager.toMarkdown(content),
          },
        ],
      };
    } else {
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: `# Rule not found: ${ruleId}`,
          },
        ],
      };
    }
  }

  if (uri.startsWith("knowledge://lessons/")) {
    const sceneStr = uri.replace("knowledge://lessons/", "");
    const parts = sceneStr.split("-");

    const scene = createScene({
      tech: parts.length > 0 ? [parts[0]] : [],
      functional: parts.length > 1 ? [parts[1]] : [],
      business: [],
    });

    const matches = matcher.matchRules(scene);

    if (matches.length === 0) {
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: `# No lessons found for scene: ${sceneStr}`,
          },
        ],
      };
    }

    const lines = [`# Lessons for ${sceneStr}\n`];

    for (const match of matches) {
      const rule = match.rule;
      const content = contentManager.loadContent(rule.id);

      lines.push(`## ${rule.id} (${rule.priority})`);
      lines.push(`**Confidence**: ${rule.confidence.toFixed(2)}`);
      lines.push(`**Relevance**: ${match.relevance_score.toFixed(2)} (${match.match_reason})`);

      if (content) {
        lines.push(`\n${content.content}\n`);
        lines.push(`**Reason**: ${content.reason}\n`);
      }
    }

    return {
      contents: [
        {
          uri,
          mimeType: "text/markdown",
          text: lines.join("\n"),
        },
      ],
    };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
});

// ============================================================================
// Server Entry Point
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("AutoImprove MCP Server (TypeScript) started");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
