#!/usr/bin/env tsx
/**
 * Direct batch rebuild script - bypasses MCP layer
 *
 * NOTE: This script directly calls BatchRebuildEngine, bypassing the MCP layer.
 * It uses additional parameters (incremental, mergeDuplicates, optimizeLowQuality,
 * deleteVeryLowQuality, veryLowQualityThreshold) that are NOT exposed in the
 * MCP schema (batch_rebuild tool).
 *
 * Use this script for:
 * - Advanced control over cleanup behavior
 * - Batch LLM optimization features (useBatchLLM)
 * - Direct Engine access without MCP overhead
 *
 * For standard rebuilds through MCP, use:
 *   await mcp.call("batch_rebuild", { force: true, ... })
 */

import { BatchRebuildEngine } from './src/mcp-server-ts/src/core/batch-rebuild.js';
import { SessionAnalyzer } from './src/mcp-server-ts/src/core/session-analyzer.js';
import { SessionCacheManager } from './src/mcp-server-ts/src/storage/session-cache.js';
import { PatternEvolutionManager } from './src/mcp-server-ts/src/storage/pattern-evolution.js';
import { HybridRuleGenerator } from './src/mcp-server-ts/src/core/hybrid-rule-generator.js';
import { BatchLLMRuleGenerator } from './src/mcp-server-ts/src/core/batch-llm-rule-generator.js';
import { RuleIndexManager } from './src/mcp-server-ts/src/storage/rule-index.js';
import { RuleContentManager } from './src/mcp-server-ts/src/storage/rule-content.js';
import { ClaudeIndexExporter } from './src/mcp-server-ts/src/tools/export-rules-to-claude.js';
import { RuleCleanupService } from './src/mcp-server-ts/src/core/rule-cleanup-service.js';
import { homedir } from 'os';
import { join } from 'path';

async function main() {
  console.log('🚀 Starting batch rebuild with LLM enhancement...');
  console.log('📊 Found 160 session files to process\n');

  const storageRoot = join(homedir(), '.autoimprove');

  // Initialize components
  const indexManager = new RuleIndexManager(storageRoot);
  const contentManager = new RuleContentManager(storageRoot);
  const cacheManager = new SessionCacheManager(storageRoot);
  const evolutionManager = new PatternEvolutionManager(storageRoot);
  const analyzer = new SessionAnalyzer(storageRoot);
  const ruleGenerator = new HybridRuleGenerator(indexManager, contentManager, evolutionManager, storageRoot);
  const batchLLMGenerator = new BatchLLMRuleGenerator(indexManager, contentManager);
  const exporter = new ClaudeIndexExporter(indexManager, contentManager);
  const cleanupService = new RuleCleanupService(indexManager, contentManager);

  const engine = new BatchRebuildEngine(
    analyzer,
    cacheManager,
    evolutionManager,
    ruleGenerator,
    batchLLMGenerator,
    indexManager,
    contentManager,
    exporter,
    cleanupService
  );

  const startTime = Date.now();

  try {
    const result = await engine.rebuild({
      force: true,                        // Force full rebuild
      incremental: false,                 // Ignore cache
      minConfidence: 0.6,
      enhancedRuleOptions: {
        useLLMEnhancement: true,          // Enable LLM enhancement
        extractCodeExamples: true,        // Extract code examples
      },
      autoCleanup: true,                  // Auto cleanup duplicates
      mergeDuplicates: true,
      optimizeLowQuality: true,
      deleteVeryLowQuality: false,
      veryLowQualityThreshold: 0.3,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n✅ Batch rebuild completed successfully!\n');
    console.log('📈 Results:');
    console.log(`   Sessions analyzed: ${result.sessions_analyzed}`);
    console.log(`   Sessions cached: ${result.sessions_cached}`);
    console.log(`   Patterns found: ${result.patterns_total}`);
    console.log(`   Patterns qualified: ${result.patterns_qualified}`);
    console.log(`   Rules generated: ${result.rules_generated}`);
    console.log(`   Rules exported: ${result.rules_exported}`);
    console.log(`   Cache hit rate: ${(result.cache_hit_rate * 100).toFixed(1)}%`);

    if (result.cleanup_performed) {
      console.log('\n🧹 Cleanup performed:');
      console.log(`   Rules merged: ${result.rules_merged || 0}`);
      console.log(`   Rules optimized: ${result.rules_optimized || 0}`);
      console.log(`   Rules deleted: ${result.rules_deleted || 0}`);
    }

    console.log(`\n⏱️  Total time: ${duration}s`);
    console.log(`\n📝 Rules auto-exported to: ~/.autoimprove/rules/claude-index.md`);

    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Batch rebuild failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
