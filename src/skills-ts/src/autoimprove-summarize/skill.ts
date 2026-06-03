#!/usr/bin/env node
/**
 * AutoImprove Summarize Skill
 *
 * Analyzes completed session and generates summary with learned patterns
 */

import { callMCPTool, closeMCPClient } from "../mcp-client.js";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface Pattern {
  type: string;
  description: string;
  confidence: number;
}

interface AnalyzeSessionResult {
  success: boolean;
  error?: string;
  patterns?: Pattern[];
  patterns_count?: number;
}

interface GenerateRulesResult {
  success: boolean;
  error?: string;
  rule_ids?: string[];
}

async function run() {
  try {
    console.log("🔍 Analyzing session...\n");

    // Detect current session file
    const sessionFile = detectSessionFile();

    if (!sessionFile) {
      console.log("❌ Could not find session file");
      console.log("\n💡 Tip: Run this command after completing a coding session");
      return;
    }

    console.log(`📄 Session: ${sessionFile.split("/").pop()}\n`);

    // Analyze session
    const result = await callMCPTool<AnalyzeSessionResult>("analyze_session", {
      session_file_path: sessionFile,
    });

    if (!result.success) {
      console.log(`❌ Analysis failed: ${result.error}`);
      return;
    }

    const patterns = result.patterns || [];
    const patternsCount = result.patterns_count || 0;

    if (patternsCount === 0) {
      console.log("✨ No new patterns detected in this session");
      console.log("\nThis could mean:");
      console.log("  • The session was exploratory (no corrections needed)");
      console.log("  • Patterns were too weak to generate rules");
      console.log("  • You're already following best practices!");
      return;
    }

    // Show summary
    console.log(`✅ Found ${patternsCount} pattern(s)\n`);

    // Group by type
    const byType: Record<string, any[]> = {};
    for (const pattern of patterns) {
      const ptype = pattern.type || "unknown";
      if (!byType[ptype]) {
        byType[ptype] = [];
      }
      byType[ptype].push(pattern);
    }

    // Show patterns
    for (const [ptype, plist] of Object.entries(byType)) {
      console.log(`📌 ${ptype.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())} (${plist.length})`);
      for (const p of plist.slice(0, 3)) {
        const desc = (p.description || "").substring(0, 80);
        const conf = p.confidence || 0;
        console.log(`   • ${desc}... (confidence: ${conf.toFixed(2)})`);
      }
      if (plist.length > 3) {
        console.log(`   ... and ${plist.length - 3} more`);
      }
      console.log();
    }

    // Generate rules
    console.log("🎯 Generating rules...\n");

    // Debug: check patterns before sending
    if (!patterns || patterns.length === 0) {
      console.log("⚠️  No patterns to generate rules from");
      return;
    }

    console.error(`[DEBUG] Patterns count: ${patterns.length}`);
    console.error(`[DEBUG] First pattern:`, JSON.stringify(patterns[0], null, 2));

    const rulesResult = await callMCPTool<GenerateRulesResult>("generate_rules", {
      patterns_json: JSON.stringify(patterns),
      scene_json: JSON.stringify({ tech: [], functional: [], business: [] }),
    });

    if (!rulesResult.success) {
      console.log(`❌ Rule generation failed: ${rulesResult.error}`);
      return;
    }

    const ruleIds = rulesResult.rule_ids || [];
    console.log(`✅ Generated ${ruleIds.length} rule(s)`);

    if (ruleIds.length > 0) {
      console.log("\n📋 Rules created:");
      for (const rid of ruleIds) {
        console.log(`   • ${rid}`);
      }

      console.log("\n💡 Next step: Run `/autoimprove-rules` to review and activate these rules");
    }
  } catch (error: any) {
    console.log(`❌ Error: ${error.message}`);
  } finally {
    await closeMCPClient();
  }
}

function detectSessionFile(): string | null {
  try {
    // Look for most recent session file in current project
    const cwd = process.cwd();
    const projectKey = cwd.replace(/\//g, "-");
    const projectDir = join(homedir(), ".claude", "projects", projectKey);

    // Try project-specific sessions first
    if (statSync(projectDir).isDirectory()) {
      const files = readdirSync(projectDir);
      const jsonlFiles = files
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(projectDir, f))
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

      if (jsonlFiles.length > 0) {
        return jsonlFiles[0];
      }
    }

    // Fallback: search all project directories
    const projectsDir = join(homedir(), ".claude", "projects");
    const projectDirs = readdirSync(projectsDir)
      .filter((d) => statSync(join(projectsDir, d)).isDirectory());

    const allFiles: string[] = [];
    for (const dir of projectDirs) {
      const dirPath = join(projectsDir, dir);
      const files = readdirSync(dirPath)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(dirPath, f));
      allFiles.push(...files);
    }

    const sortedFiles = allFiles.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    return sortedFiles[0] || null;
  } catch {
    return null;
  }
}

run().catch(console.error);
