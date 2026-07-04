#!/usr/bin/env node

/**
 * Batch rebuild script using AutoImprove's BatchRebuildEngine
 * This bypasses MCP and calls the engine directly for efficiency
 */

import { BatchRebuildEngine } from '../src/mcp-server-ts/dist/core/batch-rebuild.js';
import { homedir } from 'os';
import { join } from 'path';

async function main() {
  const engine = new BatchRebuildEngine();

  console.log('Starting batch rebuild...\n');

  const result = await engine.rebuild({
    force: false,           // Use incremental cache
    incremental: true,      // Enable caching
    minConfidence: 0.40,    // Lower threshold to capture more patterns
    dryRun: false,          // Actually generate rules
    sessionDir: join(homedir(), '.claude', 'projects'),
    enhancedRuleOptions: {
      useLLMEnhancement: false,     // Basic mode for speed
      extractCodeExamples: true,    // Include code examples
      sessionDir: join(homedir(), '.claude', 'sessions')
    }
  });

  console.log('\n=== Rebuild Complete ===');
  console.log(`Sessions analyzed: ${result.sessions_analyzed}`);
  console.log(`Sessions cached: ${result.sessions_cached}`);
  console.log(`Cache hit rate: ${result.cache_hit_rate.toFixed(1)}%`);
  console.log(`Patterns found: ${result.patterns_total}`);
  console.log(`Patterns qualified: ${result.patterns_qualified}`);
  console.log(`Rules generated: ${result.rules_generated}`);
  console.log(`Rules exported: ${result.rules_exported}`);
  console.log(`Execution time: ${(result.execution_time_ms / 1000).toFixed(1)}s`);

  process.exit(0);
}

main().catch(error => {
  console.error('Batch rebuild failed:', error);
  process.exit(1);
});
