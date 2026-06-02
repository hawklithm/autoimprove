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
import { SessionAnalyzer } from "./core/session-analyzer.js";
import { RuleGenerator } from "./core/rule-generator.js";
import { RuleMatcher } from "./core/rule-matcher.js";
import { createScene, PatternType } from "./core/models.js";
import { existsSync } from "fs";

// ============================================================================
// Initialization
// ============================================================================

let indexManager: RuleIndexManager;
let contentManager: RuleContentManager;
let analyzer: SessionAnalyzer;
let generator: RuleGenerator;
let matcher: RuleMatcher;

function ensureInitialized() {
  if (!indexManager) {
    // Initialize storage if needed
    initStorage();

    const config = loadConfig();

    indexManager = new RuleIndexManager();
    contentManager = new RuleContentManager();
    analyzer = new SessionAnalyzer();
    generator = new RuleGenerator();
    matcher = new RuleMatcher(indexManager, config.rule_matching.max_results, config.rule_matching.min_confidence);
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
        description: "Analyze a Claude Code session file and detect patterns",
        inputSchema: {
          type: "object",
          properties: {
            session_file_path: {
              type: "string",
              description: "Path to session JSONL file",
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
              description: "Optional specific rule ID",
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
        name: "health_check",
        description: "Check server health and storage status",
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

      case "health_check":
        return await handleHealthCheck();

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

  const patterns = analyzer.analyzeSession(sessionFilePath);
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
        }),
      },
    ],
  };
}

async function handleGenerateRules(args: any) {
  const patternsJson = args.patterns_json as string;
  const sceneJson = args.scene_json as string | undefined;

  const patternsData = JSON.parse(patternsJson);
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
