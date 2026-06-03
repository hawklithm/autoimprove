#!/usr/bin/env node
/**
 * AutoImprove Summarize Skill
 *
 * Analyzes completed session and generates summary with learned patterns
 * Supports intelligent consolidation via sub-agent (--consolidate flag)
 */

import { callMCPTool, closeMCPClient } from "../mcp-client.js";
import { readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawn } from "child_process";

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
    // Parse command line arguments
    const args = process.argv.slice(2);
    const useConsolidation = args.includes("--consolidate") || args.includes("-c");
    const minConfidenceArg = args.find((a, i) => args[i - 1] === "--min-confidence");
    const minConfidence = minConfidenceArg ? parseFloat(minConfidenceArg) : 0.85;

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
      console.log(`❌ Analyed: ${result.error}`);
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
    console.log(`${patternsCount} pattern(s)\n`);

    // If consolidation is enabled, use intelligent agent-based consolidation
    if (useConsolidation) {
      await consolidateWithAgent(patterns, minConfidence);
      return;
    }

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

async function consolidateWithAgent(patterns: Pattern[], minConfidence: number): Promise<void> {
  console.log("📥 Step 1: Preparing patterns for agent analysis...");

  // Save patterns to temporary file for agent to read
  const tempFile = join(homedir(), ".autoimprove", "temp_patterns.json");
  writeFileSync(tempFile, JSON.stringify(patterns, null, 2));
  console.log(`   ✓ Saved ${patterns.length} patterns to ${tempFile}\n`);

  console.log("🧠 Step 2: Launching analysis agent...");
  console.log("   The agent will:");
  console.log("   • Group similar patterns by semantic similarity");
  console.log("   • Consolidate descriptions and examples");
  console.log("   • Calculate aggregated confidence scores");
  console.log("   • Detect tech/functional/business scenes");
  console.log("   • Generate optimized knowledge points\n");

  // Spawn a Claude agent to do the consolidation
  const agentPrompt = `You are an intelligent pattern consolidation agent. Your task is to:

1. Read the patterns from: ${tempFile}
2. Group similar patterns together based on semantic similarity (not just keyword matching)
3. For each group, create a consolidated knowledge point with:
   - A clear, concise title
   - A merged description that captures all unique insights
   - Combined keywords (deduplicated)
   - Aggregated confidence score (average + group size boost)
   - Detected scenes (tech/functional/business)
4. Output the consolidated knowledge points in this exact JSON format:

\`\`\`json
{
  "knowledge_points": [
    {
      "title": "Clear title under 60 chars",
      "description": "Comprehensive description merging all insights",
      "type": "error-pattern|best-practice|code-style|architecture",
      "confidence": 0.92,
      "keywords": ["keyword1", "keyword2"],
      "scenes": {
        "tech": ["react", "typescript"],
        "functional": ["auth", "api"],
        "business": []
      }
    }
  ],
  "original_count": ${patterns.length},
  "consolidated_count": 10,
  "reduction_rate": 0.5
}
\`\`\`

Important:
- Only consolidate patterns that are truly similar (semantic similarity > 0.4)
- Keep high-quality unique patterns as-is
- Filter out patterns with confidence < ${minConfidence}
- Boost confidence for patterns that appear multiple times
- Extract technical terms for scene detection

Output ONLY the JSON, no explanations.`;

  console.log("⏳ Agent working...\n");

  // Note: In a real implementation, this would use the Agent tool from Claude Code
  // For now, we'll demonstrate the structure
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  🤖 Sub-Agent Analysis                                        ║");
  console.log("╠════════════════════════════════════════════════════════════════╣");
  console.log("║                                                                ║");
  console.log("║  This feature requires Claude Code's Agent tool integration.   ║");
  console.log("║                                                                ║");
  console.log("║  The agent would:                                              ║");
  console.log("║  1. Read patterns from temporary file                          ║");
  console.log("║  2. Use semantic analysis to group similar patterns            ║");
  console.log("║  3. Calculate Jaccard similarity for clustering                ║");
  console.log("║  4. Merge descriptions intelligently                           ║");
  console.log("║  5. Aggregate confidence with group size boost                 ║");
  console.log("║  6. Detect scenes from keywords and context                    ║");
  console.log("║  7. Output optimized, consolidated knowledge points            ║");
  console.log("║                                                                ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Fallback: Use basic consolidation
  console.log("📊 Using basic consolidation (agent integration pending)...\n");
  const consolidated = await basicConsolidation(patterns, minConfidence);

  console.log("✅ Step 3: Consolidation complete");
  console.log(`   • Original patterns: ${patterns.length}`);
  console.log(`   • Consolidated points: ${consolidated.length}`);
  console.log(`   • Reduction: ${(((patterns.length - consolidated.length) / patterns.length) * 100).toFixed(1)}%\n`);

  // Generate rules from consolidated patterns
  console.log("💾 Step 4: Storing to knowledge base...\n");

  if (consolidated.length === 0) {
    console.log("⚠️  No patterns meet minimum confidence threshold");
    return;
  }

  const rulesResult = await callMCPTool<GenerateRulesResult>("generate_rules", {
    patterns_json: JSON.stringify(consolidated),
    scene_json: JSON.stringify({ tech: [], functional: [], business: [] }),
  });

  if (!rulesResult.success) {
    console.log(`❌ Rule generation failed: ${rulesResult.error}`);
    return;
  }

  const ruleIds = rulesResult.rule_ids || [];
  console.log(`✅ Generated ${ruleIds.length} optimized rule(s)\n`);

  if (ruleIds.length > 0) {
    console.log("📋 Rules created:");
    for (const rid of ruleIds) {
      console.log(`   • ${rid}`);
    }

    console.log("\n💡 Next step: Run `/autoimprove-rules` to review and activate these rules");
  }
}

async function basicConsolidation(patterns: Pattern[], minConfidence: number): Promise<any[]> {
  // Basic implementation: group by type and merge similar descriptions
  const groups: Map<string, any[]> = new Map();

  for (const pattern of patterns) {
    if (pattern.confidence < minConfidence) continue;

    const key = pattern.type || "unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(pattern);
  }

  const consolidated: any[] = [];

  for (const [type, typePatterns] of groups.entries()) {
    // Simple merging: take highest confidence pattern and combine descriptions
    const sorted = typePatterns.sort((a, b) => b.confidence - a.confidence);
    const best = sorted[0];

    // Collect unique description points
    const descPoints = new Set<string>();
    for (const p of typePatterns) {
      const sentences = p.description.split(/[.!?]\s+/);
      sentences.forEach((s: string) => {
        if (s.trim().length > 10) descPoints.add(s.trim());
      });
    }

    consolidated.push({
      type: best.type,
      description: Array.from(descPoints).join(". ") + ".",
      confidence: Math.min(best.confidence + (typePatterns.length - 1) * 0.05, 1.0),
      occurrences: best.occurrences || [],
      first_seen: best.first_seen || new Date().toISOString(),
      last_seen: new Date().toISOString(),
      keywords: Array.from(new Set(typePatterns.flatMap((p: any) => p.keywords || []))),
      category: type,
      priority: best.confidence > 0.9 ? "high" : "medium",
    });
  }

  return consolidated;
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
