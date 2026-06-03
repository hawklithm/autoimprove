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
import { RuleMatcher } from "./core/rule-matcher.js";
import { RuleQualityController } from "./core/rule-quality.js";
import { AdaptiveConfidenceCalculator } from "./core/adaptive-confidence.js";
import { EnhancedSceneDetector } from "./core/enhanced-scene-detector.js";
import { logger } from "./core/logger.js";
import { createScene, PatternType } from "./core/models.js";
import { existsSync } from "fs";

// ============================================================================
// Initialization
// ============================================================================

let indexManager: RuleIndexManager;
let contentManager: RuleContentManager;
let versionControl: RuleVersionControl;
let analysisTracker: SessionAnalysisTracker;
let analyzer: SessionAnalyzer;
let generator: RuleGenerator;
let matcher: RuleMatcher;
let qualityController: RuleQualityController;
let adaptiveConfidence: AdaptiveConfidenceCalculator;
let sceneDetector: EnhancedSceneDetector;

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
    matcher = new RuleMatcher(indexManager, config.rule_matching.max_results, config.rule_matching.min_confidence);
    qualityController = new RuleQualityController();
    adaptiveConfidence = new AdaptiveConfidenceCalculator();
    sceneDetector = new EnhancedSceneDetector();

    logger.info("server", "AutoImprove MCP Server initialized");
  }
}

// ============================================================================
// MCP Server Setup
// ============================================================================

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
        description: "Generate rules from detected patterns",
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
          },
          required: ["patterns_json"],
        },
      },
      {
        name: "search_knowledge",
        description: "Search rules by scene, keywords, or ID",
        inputSchema: {
          type: "object",
          properties: {
            scene_json: {
              type: "string",
              description: "Optional JSON string of scene to match",
            },
            keywords: {
              type: "string",
              description: "Optional comma-separated keywords",
            },
            rule_id: {
              type: "string",
              description: "Optional ule ID",
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
  const rules = generator.batchGenerateRules(patterns, nextIdNum, scene);

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
        }),
      },
    ],
  };
}

async function handleSearchKnowledge(args: any) {
  const sceneJson = args.scene_json as string | undefined;
  const keywords = args.keywords as string | undefined;
  const ruleId = args.rule_id as string | undefined;

  // Search by ID
  if (ruleId) {
    const rule = indexManager.getRule(ruleId);
    if (rule) {
      const content = contentManager.loadContent(ruleId);
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
    const scene = JSON.parse(sceneJson);
    const kwList = keywords ? keywords.split(",") : undefined;
    const matches = matcher.matchRules(scene, kwList);

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

  // List all rules
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
    filePaths: filePaths ? filePaths.split(",").map((p) => p.trim()) : undefined,
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

// ============================================================================
// Resources
// ============================================================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
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
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  ensureInitialized();

  const uri = request.params.uri;

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
