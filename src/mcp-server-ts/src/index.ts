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
import { TemplateBasedRuleGenerator } from "./core/template-based-rule-generator.js";
import { RuleMatcher } from "./core/rule-matcher.js";
import { RuleQualityController, UNIFIED_RULE_MIN_SCORE } from "./core/rule-quality.js";
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
import { RuleDeduplicator, DeduplicationResult } from "./core/rule-deduplicator.js";
import { RuleCleanupService } from "./core/rule-cleanup-service.js";
import { logger } from "./core/logger.js";
import { createScene, PatternType, RuleScope, Scene } from "./core/models.js";
import { existsSync, readFileSync } from "fs";
import { SERVER_INSTRUCTIONS_EMPTY } from "./mcp-instructions.js";
import { selectInstructionsForIndex } from "./instruction-selection.js";
import { SEARCH_KNOWLEDGE_DESCRIPTION, emptyKnowledgeBaseMessage, noMatchMessage } from "./search-guidance.js";
import { ProactiveRuleResourceProvider } from "./resources/proactive-rules.js";
import { BatchRebuildEngine } from "./core/batch-rebuild.js";
import { PatternEvolutionManager } from "./storage/pattern-evolution.js";
import { MemoryRepository } from "./core/memory-models.js";
import { createDefaultMemoryRepository } from "./storage/memory-sqlite-store.js";
import { MemoryPromotionService } from "./core/memory-promotion.js";
import { RuleEvolutionService, RuleFeedbackKind } from "./core/rule-evolution.js";
import { KnowledgeHealthAnalyzer } from "./core/knowledge-health.js";

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

/**
 * Parse scope filter from search parameters
 */
function parseScopeFilter(
  scopesStr: string | undefined,
  currentProject: string | undefined,
  organizationId: string | undefined,
  teamId?: string,
  repository?: string,
  branch?: string
): { scopes: RuleScope[]; current_project?: string; organization_id?: string; team_id?: string; repository?: string; branch?: string } | undefined {
  // Auto-detect current project if not provided
  const projectPath = currentProject || process.cwd();

  // Parse scope list, default to all scopes
  let scopes: RuleScope[];
  if (scopesStr) {
    const scopeNames = parseCommaSeparated(scopesStr) || [];
    scopes = scopeNames
      .map(s => {
        const normalized = s.toLowerCase();
        if (normalized === "global") return RuleScope.GLOBAL;
        if (normalized === "organization") return RuleScope.ORGANIZATION;
        if (normalized === "project") return RuleScope.PROJECT;
        return null;
      })
      .filter((s): s is RuleScope => s !== null);
  } else {
    // Default: include all scopes
    scopes = [RuleScope.GLOBAL, RuleScope.ORGANIZATION, RuleScope.PROJECT];
  }

  // If scopes is empty after parsing, include all
  if (scopes.length === 0) {
    scopes = [RuleScope.GLOBAL, RuleScope.ORGANIZATION, RuleScope.PROJECT];
  }

  return {
    scopes,
    current_project: projectPath,
    organization_id: organizationId,
    team_id: teamId,
    repository,
    branch
  };
}

let indexManager: RuleIndexManager;
let contentManager: RuleContentManager;
let versionControl: RuleVersionControl;
let analysisTracker: SessionAnalysisTracker;
let proactiveRuleProvider: ProactiveRuleResourceProvider;
let analyzer: SessionAnalyzer;
let generator: RuleGenerator;
let hybridGenerator: HybridRuleGenerator;
let templateGenerator: TemplateBasedRuleGenerator | null = null; // Lazy-initialized when enabled
let deduplicator: RuleDeduplicator;
let cleanupService: RuleCleanupService;
let matcher: RuleMatcher;
let qualityController: RuleQualityController;
let adaptiveConfidence: AdaptiveConfidenceCalculator;
let sceneDetector: EnhancedSceneDetector;
let claudeIndexExporter: ClaudeIndexExporter;
let statsAnalyzer: RuleUsageStatsAnalyzer;
let batchRebuildEngine: BatchRebuildEngine;
let patternEvolution: PatternEvolutionManager;
let memoryStore: MemoryRepository;
let memoryPromotion: MemoryPromotionService;
let ruleEvolution: RuleEvolutionService;
let knowledgeHealth: KnowledgeHealthAnalyzer;
// Adaptive pattern recognition components (initialized but reserved for future use)
// Reserved for future adaptive pattern recognition features
let _signalDB: SignalDictionaryDB;
let _signalMatcher: SignalMatcher;
let _signalExtractor: LLMSignalExtractor;
let _confidenceUpdater: BayesianConfidenceUpdater;
let _patternClusterer: PatternClusterer;
let _llmRuleGenerator: LLMRuleGenerator;
let _adaptiveAnalyzer: AdaptiveSessionAnalyzer;

async function ensureInitialized() {
  if (!indexManager) {
    // Initialize storage if needed
    initStorage();

    const config = loadConfig();

    indexManager = new RuleIndexManager();
    memoryStore = createDefaultMemoryRepository();
    memoryPromotion = new MemoryPromotionService(memoryStore);

    // Trigger migration if needed (JSON → SQLite)
    const migrationStatus = indexManager.getMigrationStatus();
    if (migrationStatus.needsMigration) {
      logger.info("server", "Detected JSON storage backend, triggering migration to SQLite...");
      try {
        await indexManager.triggerMigration();
        logger.info("server", "Migration to SQLite completed successfully");
      } catch (error) {
        logger.error("server", `Migration failed: ${error}`);
        logger.warn("server", "Continuing with JSON backend as fallback");
      }
    } else {
      logger.info("server", `Storage backend: ${migrationStatus.backend}`);
    }

    contentManager = new RuleContentManager();
    versionControl = new RuleVersionControl();
    analysisTracker = new SessionAnalysisTracker();
    analyzer = new SessionAnalyzer();
    generator = new RuleGenerator();
    hybridGenerator = new HybridRuleGenerator();
    deduplicator = new RuleDeduplicator();
    cleanupService = new RuleCleanupService();
    matcher = new RuleMatcher(indexManager, config.rule_matching.max_results, config.rule_matching.min_confidence);
    qualityController = new RuleQualityController();
    ruleEvolution = new RuleEvolutionService(indexManager, contentManager, memoryStore, qualityController);
    knowledgeHealth = new KnowledgeHealthAnalyzer(indexManager, memoryStore);
    adaptiveConfidence = new AdaptiveConfidenceCalculator();
    sceneDetector = new EnhancedSceneDetector();
    claudeIndexExporter = new ClaudeIndexExporter(indexManager, contentManager);
    statsAnalyzer = new RuleUsageStatsAnalyzer(indexManager, contentManager, adaptiveConfidence);
    proactiveRuleProvider = new ProactiveRuleResourceProvider(indexManager, contentManager, sceneDetector);
    batchRebuildEngine = new BatchRebuildEngine();
    patternEvolution = new PatternEvolutionManager();

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
 * Select appropriate instructions based on storage and learned-rule availability.
 */
function selectInstructions(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) return SERVER_INSTRUCTIONS_EMPTY;

  const indexPath = `${homeDir}/.autoimprove/rules/index.json`;
  if (!existsSync(indexPath)) {
    return SERVER_INSTRUCTIONS_EMPTY;
  }

  try {
    return selectInstructionsForIndex(readFileSync(indexPath, "utf-8"));
  } catch (error) {
    logger.warn("instruction-selection", `Failed to select instructions: ${error}`);
    return SERVER_INSTRUCTIONS_EMPTY;
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
              description: "Path to session files directory (Claude: ~/.claude/sessions, Kiro: ~/.kiro/sessions)",
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
        description: SEARCH_KNOWLEDGE_DESCRIPTION,
        inputSchema: {
          type: "object",
          properties: {
            scene_json: {
              type: "string",
              description: `JSON string representing the coding scene. Structure: {"tech":[],"functional":[],"business":[]}. Examples:
- React auth: '{"tech":["react","typescript"],"functional":["auth"]}'
- Python API: '{"tech":["python"],"functional":["api","validation"]}'
- General validation: '{"tech":[],"functional":["validation"]}'
- Empty scene:"tech":[],"functional":[],"business":[]}'

All fields are arrays. Null/undefined/non-array values are normalized to []. Scene detection is case-insensitive.`,
            },
            keywords: {
              type: "string",
              description: `Comma-separated keywords to match against rule content. Examples:
- "jwt,token,authentication"
- "async,promise,error-handling"
- "sql,injection,sanitize"

Keywords are matched against rule descriptions, titles, and content. Use specific technical terms for better results.
⚠️  Must not be empty or whitespace-only. If you have no keywords, omit this parameter entirely to list all rules.`,
            },
            rule_id: {
              type: "string",
              description: `Specific rule ID to retrieve. Format: RULE-XXX (e.g., "RULE-010", "RULE-042"). Use this to fetch a single rule's full content when you know the exact ID.`,
            },
            skip_feedback: {
              type: "boolean",
              description: `Set to true to skip automatic "used" feedback recording. Default: false. Only use when browsing rules without applying them (e.g., listing all rules for review). Normal searches should record feedback to improve confidence scores.`,
            },
            current_project: {
              type: "string",
              description: `Current project path for PROJECT scope filtering. Automatically detects from CWD if not provided. Example: "/Users/name/workspace/myproject"`,
            },
            organization_id: {
              type: "string",
              description: `Organization identifier for ORGANIZATION scope filtering. Example: "mycompany", "github.com/myorg". If not provided, organization-scoped rules will still match if they have no specific organization_id constraint.`,
            },
            team_id: { type: "string", description: "Optional team identifier for team-scoped organization rules" },
            repository: { type: "string", description: "Optional repository identifier" },
            branch: { type: "string", description: "Optional branch identifier" },
            scopes: {
              type: "string",
              description: `Comma-separated list of scopes to include: "global", "organization", "project". Default: "global,organization,project" (all scopes). Examples:
- "global" - Only universal patterns
- "global,project" - Universal + current project rules
- "organization,project" - Organization + project rules (no global)`,
            },
            full_display: {
              type: "boolean",
              description: "Return all stored rule fields, including keywords, scene, scope, metadata, examples, and related rules. Default: false (agent-focused summary).",
              default: false,
            },
          },
        },
      },
      {
        name: "search_memory",
        description: "Search structured semantic, episodic, and procedural memories learned from sessions. Results include provenance, confidence, scope, and temporal status.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Natural-language query such as 'SQLite migration testing' or 'user preference for error handling'."
            },
            limit: {
              type: "number",
              description: "Maximum number of active memories to return. Default: 8."
            },
            current_project: { type: "string", description: "Optional project path for scope-aware memory retrieval" },
            organization_id: { type: "string", description: "Optional organization identifier" },
            repository: { type: "string", description: "Optional repository identifier" },
            branch: { type: "string", description: "Optional branch identifier" }
          },
          required: ["query"]
        }
      },
      {
        name: "get_rule_details",
        description: `Get the full content and details of a specific rule by ID.

This tool provides an alternative to search_knowledge when you already know the rule ID and want to fetch its complete content without searching. Useful for:
- Following up on a rule ID mentioned in previous responses
- Fetching detailed examples and exceptions for a known rule
- Getting the full markdown content for documentation

Returns: Rule metadata + full content (title, description, how_to_apply, when_to_use, exceptions, examples, full markdown)`,
        inputSchema: {
          type: "object",
          properties: {
            rule_id: {
              type: "string",
              description: "Rule ID (e.g., 'rule-001', 'RULE-010')",
            },
            include_examples: {
              type: "boolean",
              description: "Include code examples in the response (default: true)",
              default: true,
            },
          },
          required: ["rule_id"],
        },
      },
      {
        name: "get_knowledge_health",
        description: "Get health metrics for long-term memory, rule provenance, validation, and evolution.",
        inputSchema: { type: "object", properties: {} }
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
        description: "List all known scenes from rules with full tech×functional×business combinations and rule counts. Returns both dimension-level counts (backward compatible) and a sorted list of complete scene tuples for scene-aware rule lookup.",
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
            memory_id: {
              type: "string",
              description: "Optional memory ID to update memory usage strength alongside rule feedback",
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
        description: "Record feedback for a rule and its supporting memories",
        inputSchema: {
          type: "object",
          properties: {
            rule_id: {
              type: "string",
              description: "ID of rule",
            },
            feedback_type: {
              type: "string",
              enum: ["used", "accepted", "validated", "ignored", "corrected", "contradicted", "disabled"],
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
            memory_id: {
              type: "string",
              description: "Optional source Memory ID; otherwise all memories linked to the rule are updated",
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
      {
        name: "cleanup_existing_rules",
        description: "Scan and cleanup existing rules: merge duplicates, optimize low-quality rules, delete very poor rules",
        inputSchema: {
          type: "object",
          properties: {
            mode: {
              type: "string",
              enum: ["scan", "execute"],
              description: "scan: only report issues; execute: perform cleanup actions",
            },
            merge_duplicates: {
              type: "boolean",
              description: "Merge duplicate/similar rules (default: true)",
            },
            optimize_low_quality: {
              type: "boolean",
              description: "Optimize low-quality rules (default: true)",
            },
            delete_very_low_quality: {
              type: "boolean",
              description: "Delete rules with very low quality scores (default: false)",
            },
            very_low_quality_threshold: {
              type: "number",
              description: "Quality threshold for deletion (default: 0.3)",
            },
          },
          required: ["mode"],
        },
      },
      {
        name: "batch_rebuild",
        description: "Batch rebuild all rules from session files with incremental caching and optional auto-cleanup. Cleanup uses sensible defaults: merge duplicates (true), optimize low-quality (true), delete very low-quality (false).",
        inputSchema: {
          type: "object",
          properties: {
            force: {
              type: "boolean",
              description: "Force full rebuild (ignore cache)",
            },
            use_llm_enhancement: {
              type: "boolean",
              description: "Enable LLM enhancement for rules (recommended)",
            },
            extract_code_examples: {
              type: "boolean",
              description: "Extract code examples from sessions (recommended)",
            },
            auto_cleanup: {
              type: "boolean",
              description: "Automatically cleanup duplicates and optimize rules after generation (recommended)",
            },
            min_confidence: {
              type: "number",
              description: "Minimum confidence threshold (default: 0.6)",
            },
            session_limit: {
              type: "number",
              description: "Limit number of sessions to analyze (for testing)",
            },
            dry_run: {
              type: "boolean",
              description: "Dry run mode (don't save results)",
            },
            session_dir: {
              type: "string",
              description: "Custom session directory path",
            },
          },
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    await ensureInitialized();

    switch (request.params.name) {
      case "analyze_session":
        return await handleAnalyzeSession(request.params.arguments);

      case "generate_rules":
        return await handleGenerateRules(request.params.arguments);

      case "search_knowledge":
        return await handleSearchKnowledge(request.params.arguments);

      case "search_memory":
        return await handleSearchMemory(request.params.arguments);

      case "get_knowledge_health":
        return await handleGetKnowledgeHealth();

      case "get_rule_details":
        return await handleGetRuleDetails(request.params.arguments);

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

      case "cleanup_existing_rules":
        return await handleCleanupExistingRules(request.params.arguments);

      case "batch_rebuild":
        return await handleBatchRebuild(request.params.arguments);

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

  const patterns = await analyzer.analyzeSession(sessionFilePath, {
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
    project_paths: p.project_paths,
  }));

  const sessionId = sessionFilePath.split("/").pop()?.replace(/\.(jsonl|json)$/, "") || "unknown";

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

/**
 * Build a minimal structured content object from an index entry when LLM
 * enhancement produced none (e.g. API unavailable). Ensures a rule is
 * still persisted with usable content instead of failing with "Content not found".
 */
function buildBasicContent(entry: any): any {
  const description = (entry.description as string) || entry.type || "Coding pattern";
  const formatted = `# ${description}\n\n## Description\n\n${description}\n`;
  return {
    id: entry.id,
    content: formatted,
    title: description,
    description,
    reason: `Detected pattern (${entry.type})`,
    how_to_apply: [],
    when_to_use: [],
    exceptions: [],
    related_rules: [],
    metadata: {
      type: entry.type,
      priority: entry.priority,
      confidence: entry.confidence,
      keywords: entry.keywords || [],
    },
  };
}

function getMemorySupport(sourceMemoryIds: string[] | undefined): { ids: string[]; score: number } {
  const ids = Array.from(new Set(sourceMemoryIds || []));
  if (ids.length === 0) return { ids: [], score: 0.5 };
  const memories = memoryStore.list({ activeOnly: true }).filter(memory => ids.includes(memory.id));
  if (memories.length === 0) return { ids: [], score: 0.35 };
  const scores = memories.map(memory => {
    const outcome = memory.outcome?.status === "success" ? 1 : memory.outcome?.status === "failed" ? 0 : 0.5;
    return memory.confidence * 0.35
      + Math.min(1, memory.strength / 5) * 0.3
      + memory.importance * 0.15
      + outcome * 0.2;
  });
  return { ids: memories.map(memory => memory.id), score: scores.reduce((sum, score) => sum + score, 0) / scores.length };
}

function findSupportingMemoryIds(rule: { indexEntry: any; content: any }): { ids: string[]; score: number } {
  const projectPath = rule.indexEntry.scope_context?.project_path;
  const organizationId = rule.indexEntry.scope_context?.organization_id?.toLowerCase();
  const repository = rule.indexEntry.scope_context?.repository;
  const branch = rule.indexEntry.scope_context?.branch;
  const query = rule.content.description || rule.content.content || rule.indexEntry.description || "";
  if (!query.trim()) return { ids: [], score: 0.5 };
  const results = memoryStore.searchScored
    ? memoryStore.searchScored(query, 8, { projectPath, organizationId, repository, branch })
    : memoryStore.search(query, 8, { projectPath, organizationId, repository, branch }).map(memory => ({ memory, score: 0.5, reasons: ["legacy-search"] }));
  const supporting = results.filter(result => result.memory.kind !== "episodic"
    && result.score >= 0.25
    && (!organizationId || !result.memory.namespace?.organization_id || result.memory.namespace.organization_id.toLowerCase() === organizationId)
  ).slice(0, 5);
  if (supporting.length === 0) return { ids: [], score: 0.5 };
  const support = getMemorySupport(supporting.map(result => result.memory.id));
  return { ids: support.ids, score: Math.max(support.score, supporting.reduce((sum, result) => sum + result.score, 0) / supporting.length) };
}

function refreshRulesSupportedByMemory(memoryId: string): number {
  const memory = memoryStore.list({ activeOnly: false }).find(item => item.id === memoryId);
  if (!memory) return 0;
  let refreshed = 0;
  for (const entry of indexManager.getAllRules()) {
    if (!entry.source_memory_ids?.includes(memoryId)) continue;
    const content = contentManager.loadContent(entry.id);
    if (!content) continue;
    const support = getMemorySupport(entry.source_memory_ids);
    const score = qualityController.assessUnifiedScore(
      content,
      entry,
      content.metadata?.evidence_confidence ?? entry.confidence,
      content.metadata?.scope_confidence ?? entry.scope_confidence ?? 0.5,
      support.score
    );
    indexManager.replaceRule(entry.id, { ...entry, confidence: score.overall });
    content.metadata = {
      ...content.metadata,
      quality_score: score.overall,
      confidence: score.overall,
      memory_support_score: score.memory_support_score
    };
    contentManager.saveContent(content);
    refreshed++;
  }
  return refreshed;
}

function linkRuleToMemories(rule: { indexEntry: any; content?: any }): void {
  if (!memoryStore.linkRule) return;
  const now = new Date().toISOString();
  for (const memoryId of rule.indexEntry.source_memory_ids || rule.content?.metadata?.source_memory_ids || []) {
    const support = getMemorySupport([memoryId]);
    memoryStore.linkRule({
      memory_id: memoryId,
      rule_id: rule.indexEntry.id,
      relation: "supports",
      support_score: support.score,
      created_at: now,
      updated_at: now
    });
  }
}

async function handleGenerateRules(args: any) {
  const patternsJson = args.patterns_json as string;
  const sceneJson = args.scene_json as string | undefined;
  const useLLMEnhancement = args.use_llm_enhancement !== false; // Default true - enable LLM enhancement for detailed rule content
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
    project_paths: p.project_paths,
  }));

  const promotedMemories = await memoryPromotion.promoteEligibleWithLLM();
  if (promotedMemories.length > 0) {
    logger.info("memory-promotion", `Promoted ${promotedMemories.length} procedural memories before rule generation`);
    ruleEvolution.reevaluateAll();
  }

  let scene: Scene | undefined;
  if (sceneJson) {
    try {
      scene = JSON.parse(sceneJson);
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Invalid scene_json: ${error.message}. Must be a valid JSON string like {"tech":["react"],"functional":["auth"]}.`,
            }),
          },
        ],
      };
    }
  }

  const nextIdNum = parseInt(indexManager.getNextRuleId().split("-")[1], 10);

  // Check if template-based generation is enabled
  const config = loadConfig();
  const useTemplateGeneration = config.rule_generation?.use_template_generation || false;

  // Choose generation strategy based on config and options
  let rules: Array<{ indexEntry: any; content: any }>;

  if (useTemplateGeneration) {
    // Use template-based generator (SOP compiler, Phase 2+)
    logger.info("generate_rules", "Using template-based generation (SOP compiler)");

    if (!templateGenerator) {
      const hotReload = config.rule_generation?.template_hot_reload || false;
      templateGenerator = new TemplateBasedRuleGenerator({ enableHotReload: hotReload });
      logger.info("generate_rules", `Template generator initialized (hot reload: ${hotReload})`);
    }

    // Generate rules using templates
    rules = [];
    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const ruleId = `rule-${String(nextIdNum + i).padStart(3, "0")}`;

      try {
        const rule = await templateGenerator.generateRule(pattern, {
          ruleId,
          scene,
          sessionDir,
          maxExamples,
        });
        rules.push(rule);
      } catch (error: any) {
        logger.warn("generate_rules", `Template generation failed for pattern ${i}: ${error.message}`);
      }
    }

    // If template generation produced no rules (e.g. the template engine
    // crashed on these patterns), fall back to the legacy generator so we
    // still produce rules instead of returning zero.
    if (rules.length === 0) {
      logger.warn("generate_rules", "Template generation yielded 0 rules, falling back to legacy generator");
      const useEnhanced = useLLMEnhancement || extractCodeExamples;
      if (useEnhanced) {
        rules = await hybridGenerator.batchGenerateEnhancedRules(
          patterns,
          nextIdNum,
          scene,
          { useLLMEnhancement, extractCodeExamples, sessionDir, maxExamples }
        );
      } else {
        rules = generator.batchGenerateRules(patterns, nextIdNum, scene);
      }
    }
  } else {
    // Use legacy generators (backward compatibility)
    const useEnhanced = useLLMEnhancement || extractCodeExamples;

    if (useEnhanced) {
      // Use hybrid generator (Phase 2-4)
      logger.info("generate_rules", `Using hybrid generation: LLM=${useLLMEnhancement}, CodeExamples=${extractCodeExamples}`);

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
      // Use basic generator (Phase 1 only)
      logger.info("generate_rules", "Using basic generation (fast mode)");
      rules = generator.batchGenerateRules(patterns, nextIdNum, scene);
    }
  }

  // Normalize every generation mode (basic, template, and hybrid) to the
  // same evidence/content/scope score before persistence.
  rules = rules.map(rule => {
    const memorySupport = findSupportingMemoryIds(rule);
    rule.indexEntry.source_memory_ids = memorySupport.ids;
    rule.indexEntry.status = memorySupport.ids.length > 0 && memorySupport.score >= UNIFIED_RULE_MIN_SCORE ? "active" : "candidate";
    rule.content.metadata.source_memory_ids = memorySupport.ids;
    rule.content.metadata.memory_support_score = memorySupport.score;
    const unified = qualityController.assessUnifiedScore(
      rule.content,
      rule.indexEntry,
      rule.content.metadata?.evidence_confidence ?? rule.indexEntry.confidence,
      rule.content.metadata?.scope_confidence ?? 0.5,
      memorySupport.score
    );
    rule.indexEntry.confidence = unified.overall;
    rule.content.metadata.quality_score = unified.overall;
    rule.content.metadata.confidence = unified.overall;
    return rule;
  }).filter(rule => rule.indexEntry.confidence >= UNIFIED_RULE_MIN_SCORE);

  // ===== DEDUPLICATION PHASE =====
  // Automatically detect and merge similar rules
  const existingRules = indexManager.getAllRules();
  const rulesForDedup = [...existingRules];
  const contentByRuleId = new Map<string, any>();
  for (const existingRule of existingRules) {
    const existingContent = contentManager.loadContent(existingRule.id);
    if (existingContent) contentByRuleId.set(existingRule.id, existingContent);
  }
  const deduplicationResults: DeduplicationResult[] = [];
  const finalRuleIds: string[] = [];
  let addedCount = 0;
  let mergedCount = 0;
  let skippedCount = 0;

  for (const { indexEntry, content } of rules) {
    contentByRuleId.set(indexEntry.id, content);
    // Find similar rules in existing database
    const similarities = deduplicator.findSimilarRules(indexEntry, rulesForDedup, contentByRuleId);

    if (similarities.length > 0 && similarities[0].action === "merge") {
      // High similarity detected - merge into existing rule
      const topMatch = similarities[0];
      const existingContent = contentManager.loadContent(topMatch.existingRuleId);

      const merged = deduplicator.mergeRules(
        topMatch.existingRule,
        indexEntry,
        existingContent || undefined,
        content
      );

      // Update existing rule
      indexManager.replaceRule(topMatch.existingRuleId, merged.indexEntry);
      const mergeIndex = rulesForDedup.findIndex(rule => rule.id === topMatch.existingRuleId);
      if (mergeIndex >= 0) rulesForDedup[mergeIndex] = merged.indexEntry;
      if (merged.content) {
        contentManager.saveContent(merged.content);
        contentByRuleId.set(topMatch.existingRuleId, merged.content);
      }
      linkRuleToMemories({ indexEntry: merged.indexEntry, content: merged.content });

      deduplicationResults.push({
        action: "merged",
        targetRuleId: topMatch.existingRuleId,
        sourceRuleId: indexEntry.id,
        similarity: topMatch.similarity,
        reason: topMatch.reason,
      });

      finalRuleIds.push(topMatch.existingRuleId);
      mergedCount++;

      logger.info("deduplication", `Merged ${indexEntry.id} → ${topMatch.existingRuleId} (similarity: ${(topMatch.similarity * 100).toFixed(1)}%)`);
    } else if (similarities.length > 0 && similarities[0].action === "update-existing") {
      // Very similar - update existing with new examples
      const topMatch = similarities[0];
      const existingContent = contentManager.loadContent(topMatch.existingRuleId);

      const merged = deduplicator.mergeRules(
        topMatch.existingRule,
        indexEntry,
        existingContent || undefined,
        content
      );

      indexManager.replaceRule(topMatch.existingRuleId, merged.indexEntry);
      const updateIndex = rulesForDedup.findIndex(rule => rule.id === topMatch.existingRuleId);
      if (updateIndex >= 0) rulesForDedup[updateIndex] = merged.indexEntry;
      if (merged.content) {
        contentManager.saveContent(merged.content);
        contentByRuleId.set(topMatch.existingRuleId, merged.content);
      }
      linkRuleToMemories({ indexEntry: merged.indexEntry, content: merged.content });

      deduplicationResults.push({
        action: "updated",
        targetRuleId: topMatch.existingRuleId,
        sourceRuleId: indexEntry.id,
        similarity: topMatch.similarity,
        reason: "Updated with new examples",
      });

      finalRuleIds.push(topMatch.existingRuleId);
      mergedCount++;

      logger.info("deduplication", `Updated ${topMatch.existingRuleId} with content from ${indexEntry.id} (similarity: ${(topMatch.similarity * 100).toFixed(1)}%)`);
    } else {
      // No similar rule or similarity below threshold - add as new rule
      // Fall back to basic content if LLM enhancement produced none
      // (e.g. API unavailable), so the rule is still persisted.
      const ruleContent = content || buildBasicContent(indexEntry);
      indexManager.addRule(indexEntry, ruleContent);
      contentManager.saveContent(ruleContent);
      linkRuleToMemories({ indexEntry, content: ruleContent });
      rulesForDedup.push(indexEntry);

      deduplicationResults.push({
        action: "added",
        targetRuleId: indexEntry.id,
        reason: similarities.length > 0
          ? `Kept separate (similarity: ${(similarities[0].similarity * 100).toFixed(1)}%)`
          : "No similar rules found",
      });

      finalRuleIds.push(indexEntry.id);
      addedCount++;

      logger.info("deduplication", `Added new rule ${indexEntry.id} (${similarities.length > 0 ? 'below similarity threshold' : 'unique'})`);
    }
  }

  // ===== AUTO-EXPORT PHASE =====
  // Automatically update claude-index.md with top rules after generation
  try {
    logger.info("auto-export", "Updating claude-index.md with top rules...");
    const exporter = new ClaudeIndexExporter(indexManager, contentManager);
    const exportResult = exporter.export({
      limit: 10,
      minConfidence: UNIFIED_RULE_MIN_SCORE,
      strategy: "category-balanced",
    });
    logger.info("auto-export", `Successfully exported ${exportResult.rulesExported} rules to claude-index.md`);
  } catch (exportError: any) {
    logger.warn("auto-export", `Failed to auto-export rules: ${exportError.message}`);
    // Don't fail the entire generation if export fails
  }

  // Determine generation mode string for response
  let generationMode: string;
  if (useTemplateGeneration) {
    generationMode = "template";
  } else if (useLLMEnhancement || extractCodeExamples) {
    generationMode = "enhanced";
  } else {
    generationMode = "basic";
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          rules_count: finalRuleIds.length,
          ids: finalRuleIds,
          generation_mode: generationMode,
          llm_enhancement: useLLMEnhancement,
          code_examples_extracted: extractCodeExamples,
          template_based: useTemplateGeneration,
          // Deduplication statistics
          deduplication: {
            total_generated: rules.length,
            added_new: addedCount,
            merged_into_existing: mergedCount,
            skipped: skippedCount,
           nal_count: finalRuleIds.length,
            reduction_rate: rules.length > 0 ? ((rules.length - finalRuleIds.length) / rules.length) : 0,
            details: deduplicationResults,
          },
          auto_exported_to_claude_md: true,
        }),
      },
    ],
  };
}

function formatRuleForSearch(rule: any, content: any, index?: number, fullDisplay = false): string {
  let markdown = `${index !== undefined ? `## ${index}. ` : "# "}${content?.title || rule.id}\n\n`;
  markdown += `**Rule ID:** \`${rule.id}\`\n\n`;
  markdown += `**Confidence:** ${(rule.confidence * 100).toFixed(0)}%\n\n`;

  if (fullDisplay) {
    markdown += `**Priority:** ${rule.priority}\n\n`;
    markdown += "**Type:** " + (rule.type || "unknown") + "\n\n";
    markdown += "**Keywords:** " + ((rule.keywords || []).join(", ") || "none") + "\n\n";
    markdown += "## Scene\n\n";
    markdown += "- **Tech:** " + ((rule.scenes?.tech || []).join(", ") || "none") + "\n";
    markdown += "- **Functional:** " + ((rule.scenes?.functional || []).join(", ") || "none") + "\n";
    markdown += "- **Business:** " + ((rule.scenes?.business || []).join(", ") || "none") + "\n\n";
    markdown += "**Scope:** " + (rule.scope || "global") + "\n\n";
    if (rule.scope_context && Object.keys(rule.scope_context).length > 0) {
      markdown += "**Scope Context:**\n\n```json\n" +
        JSON.stringify(rule.scope_context, null, 2) + "\n```\n\n";
    }
    markdown += "**Created At:** " + (rule.created_at || "unknown") + "\n\n";
    markdown += "**Updated At:** " + (rule.updated_at || "unknown") + "\n\n";
  }

  if (!content) {
    return markdown + `**Content:** unavailable (the index entry exists, but its content file was not found)\n\n`;
  }

  if (content.description) markdown += `**Description:** ${content.description}\n\n`;
  // The legacy `content` field is usually a complete markdown document that
  // repeats the title and description already rendered above. Keep it for
  // full inspection, but omit it from the agent-focused response to avoid
  // sending the same rule twice.
  const hasStructuredContent = Boolean(
    content.description ||
    content.how_to_apply?.length ||
    content.when_to_use?.length ||
    content.exceptions?.length
  );
  if (content.content && (fullDisplay || !hasStructuredContent)) {
    markdown += `## Rule Content\n\n${content.content}\n\n`;
  }
  if (fullDisplay && content.reason) markdown += `## Reason\n\n${content.reason}\n\n`;
  if (content.how_to_apply?.length) {
    markdown += `## How to Apply\n\n${content.how_to_apply.map((item: string) => `- ${item}`).join("\n")}\n\n`;
  }
  if (content.when_to_use?.length) {
    markdown += `## When to Use\n\n${content.when_to_use.map((item: string) => `- ${item}`).join("\n")}\n\n`;
  }
  if (content.exceptions?.length) {
    markdown += `## Exceptions\n\n${content.exceptions.map((item: string) => `- ${item}`).join("\n")}\n\n`;
  }
  if (fullDisplay) {
    if (content.examples?.length) {
      markdown += "## Examples\n\n" + content.examples.map((example: any, exampleIndex: number) => {
        const bad = example.bad ? "\n**Bad:**\n\n```\n" + example.bad + "\n```\n" : "";
        return "### Example " + (exampleIndex + 1) +
          (example.language ? " (" + example.language + ")" : "") + "\n" + bad +
          "\n**Good:**\n\n```\n" + example.good + "\n```\n\n" +
          (example.explanation || "");
      }).join("\n\n") + "\n\n";
    }
    if (content.related_rules?.length) {
      markdown += "**Related Rules:** " + content.related_rules.join(", ") + "\n\n";
    }
    if (content.metadata && Object.keys(content.metadata).length > 0) {
      markdown += "## Metadata\n\n```json\n" +
        JSON.stringify(content.metadata, null, 2) + "\n```\n\n";
    }
  }
  return markdown;
}

async function handleSearchMemory(args: any) {
  const query = typeof args?.query === "string" ? args.query.trim() : "";
  const limit = typeof args?.limit === "number" ? Math.max(1, Math.min(50, args.limit)) : 8;
  if (!query) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "query is required" }) }] };
  }

  const filters = {
    projectPath: typeof args?.current_project === "string" ? args.current_project : undefined,
    organizationId: typeof args?.organization_id === "string" ? args.organization_id : undefined,
    repository: typeof args?.repository === "string" ? args.repository : undefined,
    branch: typeof args?.branch === "string" ? args.branch : undefined
  };
  const scoredMemories = memoryStore.searchScored
    ? memoryStore.searchScored(query, limit, filters)
    : memoryStore.search(query, limit, filters).map(memory => ({ memory, score: 0, reasons: ["legacy-search"] }));
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        success: true,
        query,
        count: scoredMemories.length,
        memories: scoredMemories.map(result => ({
          score: result.score,
          match_reasons: result.reasons,
          ...(() => { const memory = result.memory; return {
          id: memory.id,
          kind: memory.kind,
          content: memory.content,
          summary: memory.summary,
          pattern_type: memory.pattern_type,
          scene: memory.scene,
          keywords: memory.keywords,
          confidence: memory.confidence,
          importance: memory.importance,
          strength: memory.strength,
          valid_from: memory.valid_from,
          valid_to: memory.valid_to,
           status: memory.status,
           state: memory.state,
           support_count: memory.support_count,
           validation_count: memory.validation_count,
           evidence: memory.evidence
          }; })()
        }))
      }, null, 2)
    }]
  };
}

async function handleGetKnowledgeHealth() {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({ success: true, report: knowledgeHealth.getReport() }, null, 2)
    }]
  };
}

async function handleSearchKnowledge(args: any) {
  const sceneJson = args.scene_json as string | undefined;
  const keywords = args.keywords as string | undefined;
  const ruleId = args.rule_id as string | undefined;
  const skipFeedback = args.skip_feedback === true;
  const currentProject = args.current_project as string | undefined;
  const organizationId = args.organization_id as string | undefined;
  const teamId = args.team_id as string | undefined;
  const repository = args.repository as string | undefined;
  const branch = args.branch as string | undefined;
  const scopesStr = args.scopes as string | undefined;
  const fullDisplay = args.full_display === true;

  const startTime = Date.now();

  // 🆕 Validate keywords: reject empty string or whitespace-only values
  if (keywords !== undefined && keywords !== null && keywords.trim() === "") {
    logger.warn("search_knowledge", "Rejected empty keywords parameter", {
      scene_json: sceneJson ? (sceneJson.length > 200 ? sceneJson.substring(0, 200) + "..." : sceneJson) : undefined,
      rule_id: ruleId || undefined,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "keywords parameter cannot be empty or whitespace-only. Provide at least one meaningful keyword, or omit the parameter entirely.",
          }),
        },
      ],
    };
  }

  // 🆕 Log full input parameters
  const searchType = ruleId
    ? "by_id"
    : sceneJson
      ? "by_scene"
      : keywords
        ? "by_keywords"
        : "list_all";
  logger.info("search_knowledge", "Search request received", {
    search_type: searchType,
    raw_args: {
      scene_json: sceneJson ? (sceneJson.length > 200 ? sceneJson.substring(0, 200) + "..." : sceneJson) : undefined,
      keywords: keywords || undefined,
      rule_id: ruleId || undefined,
      skip_feedback: skipFeedback,
      current_project: currentProject || undefined,
      organization_id: organizationId || undefined,
      scopes: scopesStr || undefined,
    },
  });

  // Search by ID (case-insensitive, returns the complete stored rule)
  if (ruleId) {
    logger.info("search_knowledge", "Searching by rule ID", { rule_id: ruleId });
    const rule = indexManager.getRule(ruleId);
    if (rule) {
      const content = contentManager.loadContent(rule.id);

      // 🆕 Log successful ID search
      logger.info("search_knowledge", "Rule found by ID", {
        rule_id: rule.id,
        type: rule.type,
        priority: rule.priority,
        confidence: rule.confidence,
        has_content: !!content,
        content_length: content?.content?.length || 0,
        description_length: content?.description?.length || 0,
        examples_count: content?.examples?.length || 0,
        duration_ms: Date.now() - startTime,
      });

      // 🆕 Auto-record feedback when rule is queried
      if (!skipFeedback) {
        adaptiveConfidence.recordFeedback({
          rule_id: rule.id,
          timestamp: new Date().toISOString(),
          feedback_type: "used",
          context: "rule_query_by_id",
        });
      }

      const markdown = formatRuleForSearch(rule, content, undefined, fullDisplay);

      return {
        content: [
          {
            type: "text",
            text: markdown,
          },
        ],
      };
    } else {
      // 🆕 Log failed ID search
      logger.warn("search_knowledge", "Rule not found by ID", {
        rule_id: ruleId,
        total_rules_in_index: indexManager.listRules().length,
        duration_ms: Date.now() - startTime,
      });

      return {
        content: [
          {
            type: "text",
            text: `No rule matched ID \`${ruleId}\`. Try searching with broader keywords or list available rules with \`search_knowledge({})\`.`,
          },
        ],
      };
    }
  }

  // Parse scope filter
  const scopeFilter = parseScopeFilter(scopesStr, currentProject, organizationId, teamId, repository, branch);

  // Search by keywords only (no scene_json provided)
  // FIX: previously keyword-only queries fell through to list-all (returned every rule).
  // Route them through RuleMatcher so SQLite keyword_segments index is used with
  // relevance scoring and top-N limiting.
  if (keywords && !sceneJson) {
    const kwList = parseCommaSeparated(keywords);
    if (kwList && kwList.length > 0) {
      logger.info("search_knowledge", "Searching by keywords only", {
        keywords: kwList,
        keyword_count: kwList.length,
        scope_filter: scopeFilter,
        current_project: currentProject,
        organization_id: organizationId,
      });

      const matches = matcher.matchRules(
        createScene(), // empty scene; matching is driven by keywords
        kwList,
        undefined, // use default maxResults
        undefined, // use default minConfidence
        scopeFilter
      );

      logger.info("search_knowledge", "Keyword search completed", {
        matches_count: matches.length,
        top_3_rules: matches.slice(0, 3).map(m => ({
          id: m.rule.id,
          relevance: m.relevance_score.toFixed(3),
          priority: m.rule.priority,
          confidence: m.rule.confidence,
        })),
        total_rules_in_index: indexManager.listRules().length,
        duration_ms: Date.now() - startTime,
      });

      // Auto-record feedback for matched rules
      if (!skipFeedback && matches.length > 0) {
        const keywordContext = `keywords:${kwList.join(",")}`;
        for (const match of matches) {
          adaptiveConfidence.recordFeedback({
            rule_id: match.rule.id,
            timestamp: new Date().toISOString(),
            feedback_type: "used",
            context: `${keywordContext}:relevance:${match.relevance_score.toFixed(2)}`,
          });
        }
      }

      // Format results as markdown with the stored rule content.
      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: indexManager.listRules().length === 0 ? emptyKnowledgeBaseMessage() : noMatchMessage(indexManager.listRules().slice(0, 2).map((rule) => rule.id)),
            },
          ],
        };
      }

      let markdown = `# Found ${matches.length} Matching Rule${matches.length > 1 ? 's' : ''}\n\n`;

      const relatedMemories = memoryStore.search(kwList.join(" "), 5, { projectPath: currentProject });
      if (relatedMemories.length > 0) {
        markdown += `## Related Learned Memories\n\n`;
        for (const memory of relatedMemories) {
          markdown += `- **${memory.kind}** ${memory.summary} (confidence ${(memory.confidence * 100).toFixed(0)}%, evidence ${memory.evidence.length})\n`;
        }
        markdown += "\n";
      }

      matches.forEach((m, idx) => {
        const ruleContent = contentManager.loadContent(m.rule.id);
        if (!ruleContent) {
          logger.warn("search_knowledge", `Failed to load content for rule ${m.rule.id}`);
          markdown += formatRuleForSearch(m.rule, null, idx + 1, fullDisplay);
          markdown += `---\n\n`;
          return;
        }
        markdown += formatRuleForSearch(m.rule, ruleContent, idx + 1, fullDisplay);
        markdown += `---\n\n`;
      });

      return {
        content: [
          {
            type: "text",
            text: markdown,
          },
        ],
      };
    }
  }

  // Search by scene
  if (sceneJson) {
    let parsedScene: any;
    try {
      parsedScene = JSON.parse(sceneJson);
    } catch (error: any) {
      logger.warn("search_knowledge", "Invalid scene_json parameter", {
        scene_json: sceneJson.length > 200 ? sceneJson.substring(0, 200) + "..." : sceneJson,
        error: error.message,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Invalid scene_json: ${error.message}. Must be a valid JSON string like {"tech":["react"],"functional":["auth"]}.`,
            }),
          },
        ],
      };
    }
    const scene = createScene(parsedScene); // Normalize to ensure all fields exist
    const kwList = parseCommaSeparated(keywords);

    // 🆕 Detect multi-scenes for fuzzy matching (Optimization 4)
    const sceneWeights = sceneDetector.detectMultiScenes({
      userInput: keywords,
      filePaths: [], // No file paths in scene-based search
      projectRoot: currentProject,
    });

    // 🆕 Use multi-scene fuzzy matching if multiple scenes detected
    let matches: Array<{ rule: any; relevance_score: number; match_reason: string }>;
    let techStr: string;
    let funcStr: string;
    let bizStr: string;

    if (sceneWeights.length > 1) {
      // Multi-scene fuzzy matching (weight threshold: 0.3)
      const WEIGHT_THRESHOLD = 0.3;

      // Extract scene info from primary scene (highest weight)
      const primaryScene = sceneWeights[0].scene;
      techStr = (primaryScene.tech || []).join(",") || "none";
      funcStr = (primaryScene.functional || []).join(",") || "none";
      bizStr = (primaryScene.business || []).join(",") || "none";

      logger.info("search_knowledge", "Using multi-scene fuzzy matching", {
        scenes_count: sceneWeights.length,
        relevant_scenes: sceneWeights.filter(sw => sw.weight >= WEIGHT_THRESHOLD).length,
        weight_threshold: WEIGHT_THRESHOLD,
        primary_scene: {
          tech: techStr,
          functional: funcStr,
          business: bizStr,
        },
        all_scenes: sceneWeights.map(sw => ({
          tech: sw.scene.tech.join(","),
          functional: sw.scene.functional.join(","),
          business: sw.scene.business.join(","),
          weight: sw.weight.toFixed(2),
        })),
        scope_filter: scopeFilter,
      });

      matches = matcher.fastMatchMultiScene(
        sceneWeights,
        kwList,
        20, // maxResults
        0.3, // minConfidence
        WEIGHT_THRESHOLD,
        scopeFilter
      );
    } else {
      // Single scene matching (original logic)
      techStr = (scene.tech || []).join(",") || "none";
      funcStr = (scene.functional || []).join(",") || "none";
      bizStr = (scene.business || []).join(",") || "none";
      logger.info("search_knowledge", "Searching by single scene", {
        tech: techStr,
        functional: funcStr,
        business: bizStr,
        keywords: kwList,
        keyword_count: kwList?.length || 0,
        scope_filter: scopeFilter,
        current_project: currentProject,
        organization_id: organizationId,
        raw_scene_json: sceneJson ? (sceneJson.length > 500 ? sceneJson.substring(0, 500) + "..." : sceneJson) : undefined,
      });

      matches = matcher.matchRules(scene, kwList, undefined, undefined, scopeFilter);
    }

    // 🆕 Log search results
    const topRelevance = matches.length > 0 ? matches[0].relevance_score : 0;
    const avgRelevance = matches.length > 0
      ? matches.reduce((sum, m) => sum + m.relevance_score, 0) / matches.length
      : 0;

    logger.info("search_knowledge", "Scene search completed", {
      matches_count: matches.length,
      top_relevance: topRelevance.toFixed(3),
      avg_relevance: avgRelevance.toFixed(3),
      top_3_rules: matches.slice(0, 3).map(m => ({
        id: m.rule.id,
        relevance: m.relevance_score.toFixed(3),
        priority: m.rule.priority,
        confidence: m.rule.confidence,
        match_reason: m.match_reason,
      })),
      total_rules_in_index: indexManager.listRules().length,
      duration_ms: Date.now() - startTime,
    });

    // 🆕 Auto-record feedback for matched rules
    if (!skipFeedback && matches.length > 0) {
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
        scope_filter: scopeFilter,
        rule_ids: matches.map(m => m.rule.id),
        duration_ms: Date.now() - startTime,
      });
    }

    // Format results as markdown (summary only)
    if (matches.length === 0) {
      logger.info("search_knowledge", "Scene search returned no matches", {
        total_rules_in_index: indexManager.listRules().length,
        duration_ms: Date.now() - startTime,
      });

      return {
        content: [
          {
            type: "text",
            text: indexManager.listRules().length === 0 ? emptyKnowledgeBaseMessage() : noMatchMessage(indexManager.listRules().slice(0, 2).map((rule) => rule.id)),
          },
        ],
      };
    }

    let markdown = `# Found ${matches.length} Matching Rule${matches.length > 1 ? 's' : ''}\n\n`;

    matches.forEach((m, idx) => {
      const ruleContent = contentManager.loadContent(m.rule.id);

      if (!ruleContent) {
        logger.warn("search_knowledge", `Failed to load content for rule ${m.rule.id}`);
        markdown += formatRuleForSearch(m.rule, null, idx + 1, fullDisplay);
        markdown += `---\n\n`;
        return;
      }

      markdown += formatRuleForSearch(m.rule, ruleContent, idx + 1, fullDisplay);
      markdown += `---\n\n`;
    });

    return {
      content: [
        {
          type: "text",
          text: markdown,
        },
      ],
    };
  }

  // List all rules (no feedback recording for list-all queries)
  const rules = indexManager.listRules();

  // 🆕 Log list-all operation
  logger.info("search_knowledge", "Listing all rules", {
    total_rules: rules.length,
    priority_breakdown: {
      critical: rules.filter(r => r.priority === "critical").length,
      high: rules.filter(r => r.priority === "high").length,
      medium: rules.filter(r => r.priority === "medium").length,
      low: rules.filter(r => r.priority === "low").length,
    },
    avg_confidence: rules.length > 0
      ? (rules.reduce((sum, r) => sum + r.confidence, 0) / rules.length).toFixed(3)
      : 0,
    top_5_rules: rules.slice(0, 5).map(r => ({
      id: r.id,
      priority: r.priority,
      confidence: r.confidence,
      type: r.type,
    })),
    duration_ms: Date.now() - startTime,
  });

  // Format as markdown
  if (rules.length === 0) {
    return {
      content: [
        {
          type: "text",
          text: emptyKnowledgeBaseMessage(),
        },
      ],
    };
  }

  let markdown = `# All Rules (${rules.length} total)\n\n`;

  rules.forEach((r, idx) => {
    const ruleContent = contentManager.loadContent(r.id);

    markdown += formatRuleForSearch(r, ruleContent, idx + 1, fullDisplay);
    markdown += `---\n\n`;
  });

  return {
    content: [
      {
        type: "text",
        text: markdown,
      },
    ],
  };
}

async function handleGetRuleDetails(args: any) {
  const ruleId = args.rule_id as string;
  const includeExamples = args.include_examples !== false; // Default: true

  const rule = indexManager.getRule(ruleId);
  if (!rule) {
    return {
      content: [
        {
          type: "text",
          text: `No rule matched ID \`${ruleId}\`. Search with broader keywords, or list available rules with \`search_knowledge({})\`.`,
        },
      ],
    };
  }

  const content = contentManager.loadContent(rule.id);
  if (!content) {
    return {
      content: [
        {
          type: "text",
          text: `Rule \`${ruleId}\` exists but its content is unavailable. Run \`autoimprove rules\` to inspect or repair the knowledge base.`,
        },
      ],
    };
  }

  // Format as markdown with full details
  let markdown = `# ${content.title || rule.id}\n\n`;

  markdown += `**Rule ID:** \`${rule.id}\`\n\n`;
  markdown += `**Priority:** ${rule.priority} | **Confidence:** ${(rule.confidence * 100).toFixed(0)}%\n\n`;
  markdown += `---\n\n`;

  if (content.description) {
    markdown += `## Description\n\n${content.description}\n\n`;
  }

  if (content.how_to_apply) {
    markdown += `## How to Apply\n\n${content.how_to_apply.map(step => `- ${step}`).join("\n")}\n\n`;
  }

  if (content.when_to_use) {
    markdown += `## When to Use\n\n${content.when_to_use.map(item => `- ${item}`).join("\n")}\n\n`;
  }

  if (content.exceptions) {
    markdown += `## Exceptions\n\n${content.exceptions.map(item => `- ${item}`).join("\n")}\n\n`;
  }

  if (includeExamples && content.examples && content.examples.length > 0) {
    markdown += `## Examples\n\n`;
    content.examples.forEach((example, idx) => {
      markdown += `### Example ${idx + 1}\n\n`;
      if (example.bad) {
        markdown += `**Bad (avoid this):**\n\`\`\`${example.language || ''}\n${example.bad}\n\`\`\`\n\n`;
      }
      markdown += `**Good (do this):**\n\`\`\`${example.language || ''}\n${example.good}\n\`\`\`\n\n`;
      if (example.explanation) {
        markdown += `**Explanation:** ${example.explanation}\n\n`;
      }
    });
  }

  return {
    content: [
      {
        type: "text",
        text: markdown,
      },
    ],
  };
}

async function handleUpdateRules(args: any) {
  const ruleId = args.rule_id as string;
  const updatesJson = args.updates_json as string;

  let updates: any;
  try {
    updates = JSON.parse(updatesJson);
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Invalid updates_json: ${error.message}. Must be a valid JSON string.`,
          }),
        },
      ],
    };
  }

  // Validate that updates object is not empty
  if (!updates || typeof updates !== "object" || Array.isArray(updates) || Object.keys(updates).length === 0) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: "updates_json must be a non-empty JSON object",
          }),
        },
      ],
    };
  }

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

  // Collect unique scene combinations (tech × functional × business) with rule counts
  const sceneMap = new Map<string, { scene: Scene; ruleCount: number; ruleIds: string[] }>();

  for (const rule of rules) {
    if (rule.scenes) {
      const s = rule.scenes;
      // Use each combination of tech + functional + business as a key
      // If any dimension is empty, use a placeholder
      const techKeys = s.tech.length > 0 ? s.tech : ["*"];
      const funcKeys = s.functional.length > 0 ? s.functional : ["*"];
      const bizKeys = s.business.length > 0 ? s.business : ["*"];

      for (const tech of techKeys) {
        for (const func of funcKeys) {
          for (const biz of bizKeys) {
            const key = `${tech}|${func}|${biz}`;
            if (!sceneMap.has(key)) {
              sceneMap.set(key, {
                scene: createScene({ tech: [tech], functional: [func], business: [biz] }),
                ruleCount: 0,
                ruleIds: [],
              });
            }
            const entry = sceneMap.get(key)!;
            entry.ruleCount++;
            if (!entry.ruleIds.includes(rule.id)) {
              entry.ruleIds.push(rule.id);
            }
          }
        }
      }
    }
  }

  // Sort by rule count descending
  const scenes = Array.from(sceneMap.values())
    .sort((a, b) => b.ruleCount - a.ruleCount);

  // Also collect dimension-level counts (backward compatible)
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
          // Full scene combinations (sorted by popularity)
          scenes: scenes.map(({ scene, ruleCount, ruleIds }) => ({
            tech: scene.tech,
            functional: scene.functional,
            business: scene.business,
            ruleCount,
            ruleIds,
          })),
          // Summary counts per dimension (backward compatible)
          tech: techCounts,
          functional: functionalCounts,
          business: businessCounts,
          // Total unique rules
          totalRules: rules.length,
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
  try {
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
  } catch (error: any) {
    logger.error("compact-cache", "Failed to get compact cache stats", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Failed to get compact cache stats: ${error.message}`,
          }),
        },
      ],
    };
  }
}

async function handleClearCompactCache(args: any) {
  const sessionId = args.session_id as string | undefined;

  try {
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
  } catch (error: any) {
    logger.error("compact-cache", "Failed to clear compact cache", error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Failed to clear compact cache: ${error.message}`,
          }),
        },
      ],
    };
  }
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
  const memoryId = args.memory_id as string | undefined;
  const feedbackType = args.feedback_type as "used" | "accepted" | "validated" | "ignored" | "corrected" | "contradicted" | "disabled";
  const userRating = args.user_rating as number | undefined;
  const context = args.context as string | undefined;

  const adaptiveFeedbackType: "used" | "ignored" | "corrected" | "disabled" = feedbackType === "accepted" || feedbackType === "validated" ? "used" : feedbackType === "contradicted" ? "corrected" : feedbackType;
  const feedback = {
    rule_id: ruleId,
    timestamp: new Date().toISOString(),
    feedback_type: adaptiveFeedbackType,
    user_rating: userRating,
    context: context,
  };

  adaptiveConfidence.recordFeedback(feedback);
  const linkedMemoryIds = Array.from(new Set(
    memoryId ? [memoryId] : (indexManager.getRule(ruleId)?.source_memory_ids || [])
  ));
  if (memoryStore.recordUsage) {
    const event = feedbackType === "used" ? "applied"
      : feedbackType === "accepted" ? "accepted"
      : feedbackType === "validated" ? "validated"
      : feedbackType === "corrected" ? "corrected"
      : feedbackType === "contradicted" ? "contradicted"
      : feedbackType === "disabled" || feedbackType === "ignored" ? "rejected"
      : "recalled";
    for (const linkedId of linkedMemoryIds) {
      memoryStore.recordUsage(linkedId, event);
      refreshRulesSupportedByMemory(linkedId);
    }
  }
  const evolutionFeedback: RuleFeedbackKind = feedbackType === "used" ? "applied"
    : feedbackType === "accepted" ? "accepted"
    : feedbackType === "validated" ? "validated"
    : feedbackType === "corrected" ? "corrected"
    : feedbackType === "contradicted" ? "contradicted"
    : feedbackType === "disabled" ? "disabled"
    : feedbackType === "ignored" ? "ignored"
    : "recalled";
  ruleEvolution.recordFeedback(ruleId, evolutionFeedback);
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

  // F3: after a session is analyzed, incrementally update the user's
  // personalization profile (centroid + thresholds) from this session's matched
  // signals. Requires explicit user_id + enabled personalization; otherwise
  // legacy behavior is preserved (no-op).
  const userId = args.user_id as string | undefined;
  if (userId && loadConfig().local_ml?.personalization?.enabled) {
    try {
      const positiveSignalTexts = _signalDB.getSignalTextsBySession(sessionId);
      if (positiveSignalTexts.length > 0) {
        adaptiveConfidence.recordSessionAnalyzed(userId, positiveSignalTexts);
      }
    } catch (err) {
      logger.warn("personalization", `Failed to update profile for ${userId}`, { error: String(err) });
    }
  }

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
    const match = path.match(/([a-f0-9-]{36})\.(jsonl|json)$/);
    return match ? match[1] : null;
  }).filter((id): id is string => id !== null);

  const unanalyzedIds = analysisTracker.filterUnanalyzed(sessionIds);

  // Map back to full paths
  const unanalyzedPaths = sessionFilePaths.filter((path) => {
    const match = path.match(/([a-f0-9-]{36})\.(jsonl|json)$/);
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
  const match = sessionFilePath.match(/([a-f0-9-]{36})\.(jsonl|json)$/);
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

    // Clear the SQLite rules database (rules.db) so a rebuild starts empty.
    // Without this, stale rows remain and generate_rules collides with
    // missing content files ("Content not found for rule rule-0XX").
    const sqlite = indexManager.getSQLiteStorage();
    if (sqlite) {
      try {
        sqlite.clearAll();
      } catch (dbError: any) {
        logger.error("clear", "Failed to clear SQLite rules DB", dbError);
      }
    }

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
    const clusters = await _patternClusterer.clusterPatterns(filteredContent);
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
    const clusters = await _patternClusterer.clusterPatterns(labeledContent);

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
      const memorySupport = findSupportingMemoryIds(converted);
      converted.indexEntry.source_memory_ids = memorySupport.ids;
      converted.indexEntry.status = memorySupport.ids.length > 0 && memorySupport.score >= UNIFIED_RULE_MIN_SCORE ? "active" : "candidate";
      converted.content.metadata.source_memory_ids = memorySupport.ids;
      converted.content.metadata.memory_support_score = memorySupport.score;
      const unified = qualityController.assessUnifiedScore(
        converted.content,
        converted.indexEntry,
        converted.content.metadata.evidence_confidence ?? converted.indexEntry.confidence,
        converted.content.metadata.scope_confidence ?? converted.indexEntry.scope_confidence ?? 0.5,
        memorySupport.score
      );
      converted.indexEntry.confidence = unified.overall;
      converted.content.metadata.quality_score = unified.overall;
      converted.content.metadata.confidence = unified.overall;
      if (unified.overall < UNIFIED_RULE_MIN_SCORE) continue;

      indexManager.addRule(converted.indexEntry, converted.content);

      contentManager.saveContent({
        id: rule.id,
        content: converted.content.content,
        reason: converted.content.reason,
        metadata: converted.content.metadata,
      });
      linkRuleToMemories({ indexEntry: converted.indexEntry, content: converted.content });

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

async function handleCleanupExistingRules(args: any) {
  const mode = args.mode as "scan" | "execute";
  const mergeDuplicates = args.merge_duplicates !== false; // Default true
  const optimizeLowQuality = args.optimize_low_quality !== false; // Default true
  const deleteVeryLowQuality = args.delete_very_low_quality === true; // Default false
  const veryLowQualityThreshold = args.very_low_quality_threshold || 0.3;

  try {
    // Load all existing rules
    const allRules = indexManager.getAllRules();

    // Load contents for quality assessment
    const contents = new Map<string, any>();
    for (const rule of allRules) {
      const content = contentManager.loadContent(rule.id);
      if (content) {
        contents.set(rule.id, content);
      }
    }

    logger.info("cleanup", `Starting cleanup in ${mode} mode`, {
      total_rules: allRules.length,
      merge_duplicates: mergeDuplicates,
      optimize_low_quality: optimizeLowQuality,
      delete_very_low_quality: deleteVeryLowQuality,
    });

    // Scan for issues
    const report = cleanupService.scanExistingRules(allRules, contents);

    if (mode === "scan") {
      // Scan-only mode: return report
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              mode: "scan",
              report: {
                total_rules: report.totalRules,
                duplicate_groups: report.duplicateGroups.length,
                duplicate_rules_count: report.duplicateGroups.reduce(
                  (sum, g) => sum + g.duplicates.length,
                  0
                ),
                low_quality_rules_count: report.lowQualityRules.length,
                recommendations: report.recommendations,
                duplicate_details: report.duplicateGroups.map((g) => ({
                  primary: g.primaryRule.id,
                  duplicates: g.duplicates.map((d) => ({
                    id: d.rule.id,
                    similarity: d.similarity,
                    reason: d.reason,
                  })),
                })),
                low_quality_details: report.lowQualityRules.map((qa) => ({
                  rule_id: qa.ruleId,
                  score: qa.overallScore,
                  issues: qa.issues,
                  recommendations: qa.recommendations,
                })),
              },
            }),
          },
        ],
      };
    } else {
      // Execute mode: perform cleanup
      const result = cleanupService.executeCleanup(
        report.duplicateGroups,
        report.lowQualityRules,
        allRules,
        contents,
        {
          mergeDuplicates,
          optimizeLowQuality,
          deleteVeryLowQuality,
          veryLowQualityThreshold,
        }
      );

      // Apply changes to storage
      if (result.success) {
        // Merge duplicates
        for (const merged of result.details.merged) {
          const primary = allRules.find((r) => r.id === merged.to);
          if (primary) {
            // Merge all duplicates into primary
            for (const dupId of merged.from) {
              const duplicate = allRules.find((r) => r.id === dupId);
              if (duplicate) {
                const primaryContent = contentManager.loadContent(primary.id);
                const dupContent = contentManager.loadContent(dupId);

                const mergedRule = deduplicator.mergeRules(
                  primary,
                  duplicate,
                  primaryContent || undefined,
                  dupContent || undefined
                );

             // Update primary rule
                indexManager.replaceRule(primary.id, mergedRule.indexEntry);
                if (mergedRule.content) {
                  contentManager.saveContent(mergedRule.content);
                }

                // Delete duplicate
                indexManager.removeRule(dupId);
                contentManager.deleteContent(dupId);
              }
            }
          }
        }

        // Optimize low-quality rules
        for (const ruleId of result.details.optimized) {
          const rule = allRules.find((r) => r.id === ruleId);
          if (rule) {
            const content = contents.get(ruleId);
            const optimized = cleanupService.optimizeRule(rule, content);

            indexManager.replaceRule(ruleId, optimized.indexEntry);
            if (optimized.content) {
              contentManager.saveContent(optimized.content);
            }
          }
        }

        // Delete very low-quality rules
        for (const ruleId of result.details.deleted) {
          indexManager.removeRule(ruleId);
          contentManager.deleteContent(ruleId);
        }

        logger.info("cleanup", "Cleanup completed successfully", {
          merged: result.mergedCount,
          optimized: result.optimizedCount,
          deleted: result.deletedCount,
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: result.success,
              mode: "execute",
              result: {
                merged_count: result.mergedCount,
                optimized_count: result.optimizedCount,
                deleted_count: result.deletedCount,
                errors: result.errors,
                details: result.details,
              },
            }),
          },
        ],
      };
    }
  } catch (error: any) {
    logger.error("cleanup", "Cleanup failed", error);
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

async function handleBatchRebuild(args: any) {
  try {
    const result = await batchRebuildEngine.rebuild({
      force: args.force === true,
      incremental: !args.force, // Use incremental mode unless force is set
      minConfidence: args.min_confidence ?? UNIFIED_RULE_MIN_SCORE,
      sessionLimit: args.session_limit,
      dryRun: args.dry_run === true,
      sessionDir: args.session_dir,
      enhancedRuleOptions: {
        useLLMEnhancement: !!args.use_llm_enhancement,
        extractCodeExamples: !!args.extract_code_examples,
      },
      autoCleanup: args.auto_cleanup !== false,
      // Use sensible defaults for cleanup options (not exposed in schema to reduce parameter count)
      mergeDuplicates: true,
      optimizeLowQuality: true,
      deleteVeryLowQuality: false,
      veryLowQualityThreshold: 0.3,
    });

    // ===== AUTO-EXPORT PHASE =====
    // Automatically update claude-index.md with top rules after batch rebuild
    if (!args.dry_run) {
      try {
        logger.info("auto-export", "Updating claude-index.md with top rules after batch rebuild...");
        const exporter = new ClaudeIndexExporter(indexManager, contentManager);
        const exportResult = exporter.export({
          limit: 10,
          minConfidence: UNIFIED_RULE_MIN_SCORE,
          strategy: "category-balanced",
        });
        logger.info("auto-export", `Successfully exported ${exportResult.rulesExported} rules to claude-index.md`);
        // Add export metadata to result (TypeScript will allow this as it's any/Record)
        (result as any).auto_exported_to_claude_md = true;
        (result as any).exported_rules_count = exportResult.rulesExported;
      } catch (exportError: any) {
        logger.warn("auto-export", `Failed to auto-export rules: ${exportError.message}`);
        (result as any).auto_export_warning = exportError.message;
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            result,
          }),
        },
      ],
    };
  } catch (error: any) {
    logger.error("batch_rebuild", "Batch rebuild failed", error);
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
  await ensureInitialized();

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
  await ensureInitialized();

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

  logger.info("server", "AutoImprove MCP Server (TypeScript) started");
  // Key lifecycle node: print to console so operators see start/stop clearly
  // stdout is reserved for MCP JSON-RPC messages in stdio mode.
  console.error(`[AutoImprove] MCP server started. Logs: ${logger.getLogFile()}`);

  // Key lifecycle node: print on graceful shutdown
  process.on("SIGINT", () => {
    console.error("[AutoImprove] MCP server shutting down (SIGINT)...");
    logger.shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    console.error("[AutoImprove] MCP server shutting down (SIGTERM)...");
    logger.shutdown();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error("server", "Server startup failed", error);
  console.error("[AutoImprove] MCP server failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
