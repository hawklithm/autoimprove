#!/usr/bin/env tsx

/**
 * Direct rule rebuild script - bypasses MCP tools
 * Calls the core logic directly
 */

import * as path from 'path';
import * as fs from 'fs';
import { SessionAnalyzer } from '../src/mcp-server-ts/src/core/session-analyzer.js';
import { RuleGenerator } from '../src/mcp-server-ts/src/core/rule-generator.js';
import { RuleIndex } from '../src/mcp-server-ts/src/storage/rule-index.js';

const HOME = process.env.HOME || '~';
const AUTOIMPROVE_DIR = path.join(HOME, '.autoimprove');
const SESSIONS_DIR = path.join(HOME, '.claude/sessions');

async function main() {
  console.log('🔄 Starting rule rebuild (direct mode)\n');

  // Create backup
  const backupDir = path.join(AUTOIMPROVE_DIR, `rules_backup_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`);
  console.log(`Creating backup: ${backupDir}`);
  fs.cpSync(path.join(AUTOIMPROVE_DIR, 'rules'), backupDir, { recursive: true });

  // Initialize components
  const analyzer = new SessionAnalyzer();
  const generator = new RuleGenerator();
  const ruleIndex = new RuleIndex();

  // Find all main sessions
  const sessionFiles = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl') && !f.includes('-subagent-'))
    .map(f => path.join(SESSIONS_DIR, f));

  console.log(`Found ${sessionFiles.length} session files\n`);

  let totalPatterns = 0;
  let totalRules = 0;

  // Analyze each session
  for (let i = 0; i < sessionFiles.length; i++) {
    const sessionFile = sessionFiles[i];
    const sessionId = path.basename(sessionFile, '.jsonl');

    process.stdout.write(`\rAnalyzing ${i + 1}/${sessionFiles.length}: ${sessionId.slice(0, 8)}...`);

    try {
      // Analyze session
      const result = await analyzer.analyzeSession(sessionFile);

      if (result.patterns.length === 0) continue;

      totalPatterns += result.patterns.length;

      // Generate rules from patterns
      const rules = await generator.generateRules(result.patterns);

      if (rules.length === 0) continue;

      totalRules += rules.length;

      // Save rules
      for (const rule of rules) {
        await ruleIndex.addRule(rule);
      }

    } catch (error) {
      console.error(`\n⚠ Error analyzing ${sessionId}: ${error}`);
    }
  }

  console.log(`\n\n✓ Analysis complete`);
  console.log(`  Patterns found: ${totalPatterns}`);
  console.log(`  Rules generated: ${totalRules}`);

  // Export to claude-index.md
  console.log('\nExporting top rules to claude-index.md...');
  const exportPath = path.join(AUTOIMPROVE_DIR, 'rules', 'claude-index.md');

  const topRules = await ruleIndex.searchRules({
    minConfidence: 0.7,
    limit: 10,
    sortBy: 'confidence'
  });

  let markdown = '# AutoImprove Rules (Auto-exported)\n\n';
  markdown += `*Last updated: ${new Date().toISOString()}*\n\n`;

  for (const rule of topRules) {
    markdown += `## ${rule.title}\n\n`;
    markdown += `**Priority**: ${rule.priority} | **Confidence**: ${(rule.confidence * 100).toFixed(0)}%\n\n`;
    markdown += `${rule.description}\n\n`;
    if (rule.rationale) {
      markdown += `*Why*: ${rule.rationale}\n\n`;
    }
    markdown += '---\n\n';
  }

  fs.writeFileSync(exportPath, markdown, 'utf-8');
  console.log(`✓ Exported ${topRules.length} rules to ${exportPath}`);
}

main().catch(console.error);
