#!/usr/bin/env node
/**
 * AutoImprove Status Skill
 *
 * Shows system status and statistics
 */

import { callMCPTool, closeMCPClient } from "../mcp-client.js";

interface StorageInfo {
  initialized: boolean;
  storage_root: string;
  rules_count?: number;
}

interface HealthCheckResult {
  success: boolean;
  error?: string;
  storage?: StorageInfo;
}

interface ListScenesResult {
  success: boolean;
  tech?: Record<string, any>;
  functional?: Record<string, any>;
}

async function run() {
  try {
    // Call MCP server health check
    const result = await callMCPTool<HealthCheckResult>("health_check", {});

    if (!result.success) {
      console.log("❌ AutoImprove system is not healthy");
      console.log(`Error: ${result.error || "Unknown error"}`);
      return;
    }

    const storage = result.storage || {
      initialized: false,
      storage_root: "",
      rules_count: 0,
    };

    if (!storage.initialized) {
      console.log("👋 Welcome to AutoImprove!");
      console.log("\nAutoImprove learns from your coding patterns and generates reusable rules.");
      console.log("\nStorage will be initialized automatically.");
      console.log("\nNext steps:");
      console.log("1. Complete a coding session with Claude Code");
      console.log("2. Run `/autoimprove-summarize` to analyze the session");
      console.log("3. Review and activate generated rules with `/autoimprove-rules`");
      return;
    }

    // Show status
    console.log("📊 AutoImprove Status\n");
    console.log(`Storage: ${storage.storage_root}`);
    console.log(`Rules: ${storage.rules_count || 0}`);
    console.log(`Storage initialized: ${storage.initialized ? "Yes" : "No"}`);

    if (storage.rules_count === 0) {
      console.log("\n💡 No rules yet. Run `/autoimprove-summarize` after a session to start learning.");
    } else {
      // Show recent activity
      console.log("\n📈 Recent Activity:");

      // Get scenes
      try {
        const scenesResult = await callMCPTool<ListScenesResult>("list_scenes", {});
        if (scenesResult.success) {
          const tech = scenesResult.tech || {};
          if (Object.keys(tech).length > 0) {
            console.log(`  Tech stacks: ${Object.keys(tech).slice(0, 5).join(", ")}`);
          }

          const functional = scenesResult.functional || {};
          if (Object.keys(functional).length > 0) {
            console.log(`  Domains: ${Object.keys(functional).slice(0, 5).join(", ")}`);
          }
        }
      } catch (err) {
        // Ignore scene errors
      }
    }

    console.log("\n✨ System is healthy and ready");
  } catch (error: any) {
    console.log(`❌ Error: ${error.message}`);
    console.log("\nMake sure the MCP Server is configured correctly in ~/.claude/config.json");
  } finally {
    await closeMCPClient();
  }
}

run().catch(console.error);
