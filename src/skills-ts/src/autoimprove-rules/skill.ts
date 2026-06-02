#!/usr/bin/env node
/**
 * AutoImprove Rules Skill
 *
 * Review and manage generated rules
 */

import { callMCPTool, closeMCPClient } from "../mcp-client.js";

interface Rule {
  id: string;
  type: string;
  priority?: string;
  confidence: number;
  keywords?: string[];
}

interface SearchKnowledgeResult {
  success: boolean;
  error?: string;
  matches?: Array<{ rule: Rule }>;
}

async function run() {
  try {
    console.log("📋 AutoImprove Rules\n");

    // Search all rules
    const result = await callMCPTool<SearchKnowledgeResult>("search_knowledge", {});

    if (!result.success) {
      console.log(`❌ Failed to load rules: ${result.error}`);
      return;
    }

    const matches = result.matches || [];

    if (matches.length === 0) {
      console.log("No rules found yet.");
      console.log("\n💡 Run `/autoimprove-summarize` after a coding session to generate rules");
      return;
    }

    console.log(`Found ${matches.length} rule(s):\n`);

    // Group by priority
    const byPriority: Record<string, any[]> = {};
    for (const match of matches) {
      const rule = match.rule;
      const priority = rule.priority || "medium";
      if (!byPriority[priority]) {
        byPriority[priority] = [];
      }
      byPriority[priority].push(rule);
    }

    // Show rules by priority
    const priorityOrder = ["critical", "high", "medium", "low"];
    for (const priority of priorityOrder) {
      const rules = byPriority[priority];
      if (!rules || rules.length === 0) continue;

      console.log(`\n${"🔴🟠🟡🟢"[priorityOrder.indexOf(priority)]} ${priority.toUpperCase()} Priority (${rules.length})`);
      for (const rule of rules) {
        console.log(`   ${rule.id} - ${rule.type.replace(/-/g, " ")} (conf: ${rule.confidence.toFixed(2)})`);
        if (rule.keywords && rule.keywords.length > 0) {
          console.log(`     Keywords: ${rule.keywords.slice(0, 3).join(", ")}`);
        }
      }
    }

    console.log("\n💡 Use `/autoimprove-lessons` to see rules applicable to your current work");
  } catch (error: any) {
    console.log(`❌ Error: ${error.message}`);
  } finally {
    await closeMCPClient();
  }
}

run().catch(console.error);
