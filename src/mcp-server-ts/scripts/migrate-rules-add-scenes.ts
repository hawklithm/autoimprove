#!/usr/bin/env node
/**
 * Migration script to add scenes and keywords to existing rules
 *
 * This script reads existing rules that have empty scenes/keywords,
 * reconstructs patterns from rule content, and uses the new extraction
 * logic to populate missing scene and keyword data.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { RuleIndex, RuleIndexEntry, RuleContent, Pattern, PatternType, createPattern } from '../src/core/models.js';
import { HybridRuleGenerator } from '../src/core/hybrid-rule-generator.js';

const AUTOIMPROVE_DIR = join(homedir(), '.autoimprove');
const INDEX_PATH = join(AUTOIMPROVE_DIR, 'rules', 'index.json');
const CONTENT_DIR = join(AUTOIMPROVE_DIR, 'rules', 'content');

async function migrateRules() {
  if (!existsSync(INDEX_PATH)) {
    console.log('❌ No rule index found at:', INDEX_PATH);
    process.exit(1);
  }

  // Read existing index
  const indexData: RuleIndex = JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  console.log(`📋 Found ${indexData.rules.length} rules`);

  // Count rules needing migration
  const needsMigration = indexData.rules.filter(
    rule => rule.scenes.tech.length === 0 &&
            rule.scenes.functional.length === 0 &&
            rule.scenes.business.length === 0 &&
            rule.keywords.length === 0
  );

  console.log(`🔍 ${needsMigration.length} rules need scene/keyword extraction`);

  if (needsMigration.length === 0) {
    console.log('✅ All rules already have scenes and keywords');
    return;
  }

  // Initialize generator
  const generator = new HybridRuleGenerator();
  let updated = 0;
  let failed = 0;

  // Process each rule
  for (const rule of needsMigration) {
    try {
      // Read rule content
      const contentPath = join(CONTENT_DIR, `${rule.id}.md`);
      if (!existsSync(contentPath)) {
        console.log(`⚠️  Content file not found for ${rule.id}, skipping`);
        continue;
      }

      const contentText = readFileSync(contentPath, 'utf-8');

      // Reconstruct a minimal pattern from rule content
      const pattern = createPattern({
        type: rule.type,
        description: extractDescription(contentText),
        occurrences: [
          {
            session_id: 'migration',
            timestamp: rule.created_at,
            user_action: 'explicit_correction',
            context: contentText.substring(0, 500) // Use content as context
          }
        ],
        first_seen: rule.created_at,
        last_seen: rule.updated_at,
        confidence: rule.confidence,
        keywords: rule.keywords
      });

      // Use the new extraction method via reflection
      // @ts-ignore - accessing private method for migration
      const sceneData = generator['extractSceneFromPattern'](pattern);

      // Update rule index entry
      rule.scenes = sceneData.scene;
      rule.keywords = sceneData.keywords;
      rule.updated_at = new Date().toISOString();

      updated++;
      console.log(`✓ ${rule.id}: tech=[${sceneData.scene.tech.join(',')}] functional=[${sceneData.scene.functional.join(',')}] keywords=${sceneData.keywords.length}`);

    } catch (error) {
      failed++;
      console.error(`✗ ${rule.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Write updated index
  const backupPath = INDEX_PATH + '.backup.' + Date.now();
  writeFileSync(backupPath, JSON.stringify(indexData, null, 2));
  console.log(`\n💾 Backup saved to: ${backupPath}`);

  writeFileSync(INDEX_PATH, JSON.stringify(indexData, null, 2));
  console.log(`✅ Updated index written to: ${INDEX_PATH}`);

  console.log(`\n📊 Summary:`);
  console.log(`   - Updated: ${updated}`);
  console.log(`   - Failed: ${failed}`);
  console.log(`   - Total processed: ${needsMigration.length}`);
}

/**
 * Extract description from markdown content
 */
function extractDescription(content: string): string {
  // Try to find ## Description section
  const descMatch = content.match(/##\s+Description\s*\n\n([^\n]+(?:\n(?!##)[^\n]+)*)/);
  if (descMatch) {
    return descMatch[1].trim();
  }

  // Fallback: use first paragraph after title
  const lines = content.split('\n');
  let inContent = false;
  const descLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('# ')) {
      inContent = true;
      continue;
    }
    if (inContent && line.trim() && !line.startsWith('#')) {
      descLines.push(line);
      if (descLines.length >= 3) break; // Take first 3 lines
    }
  }

  return descLines.join(' ').substring(0, 200);
}

// Run migration
migrateRules().catch(error => {
  console.error('Migration failed:', error);
  process.exit(1);
});
