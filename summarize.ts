#!/usr/bin/env tsx
/**
 * AutoImprove Summarize CLI
 *
 * 命令行工具，用于分析 Claude Code sessions 并生成规则
 *
 * Usage:
 *   ./summarize.ts [options]
 *
 * Options:
 *   --force              强制重新分析所有 sessions（忽略缓存）
 *   --session-dir <dir>  自定义 session 目录（默认：~/.claude/projects）
 *   --limit <n>          限制分析的 session 数量（用于测试）
 *   --min-confidence <n> 最低置信度阈值（默认：0.6）
 *   --dry-run            模拟运行，不保存结果
 *   --no-cleanup         跳过自动清理（合并重复规则等）
 *   --no-llm             禁用 LLM 增强（仅使用基础模式检测）
 *   --no-export          跳过导出到 claude-index.md
 *   --help               显示帮助信息
 */

import * as os from 'os';
import * as path from 'path';
import { initStorage } from './src/mcp-server-ts/src/storage/init.js';
import { RuleIndexManager } from './src/mcp-server-ts/src/storage/rule-index.js';
import { RuleContentManager } from './src/mcp-server-ts/src/storage/rule-content.js';
import { BatchRebuildEngine } from './src/mcp-server-ts/src/core/batch-rebuild.js';
import { ClaudeIndexExporter } from './src/mcp-server-ts/src/tools/export-rules-to-claude.js';
import { cliLogger } from './src/utils/cli-logger.js';

interface CliOptions {
  force: boolean;
  sessionDir: string;
  limit?: number;
  minConfidence: number;
  dryRun: boolean;
  noCleanup: boolean;
  noLlm: boolean;
  noExport: boolean;
  help: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    force: false,
    sessionDir: path.join(os.homedir(), '.claude', 'projects'),
    minConfidence: 0.6,
    dryRun: false,
    noCleanup: false,
    noLlm: false,
    noExport: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--force':
        options.force = true;
        break;
      case '--session-dir':
        options.sessionDir = args[++i];
        break;
      case '--limit':
        options.limit = parseInt(args[++i], 10);
        break;
      case '--min-confidence':
        options.minConfidence = parseFloat(args[++i]);
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--no-cleanup':
        options.noCleanup = true;
        break;
      case '--no-llm':
        options.noLlm = true;
        break;
      case '--no-export':
        options.noExport = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        cliLogger.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  return options;
}

function showHelp() {
  cliLogger.print(`
AutoImprove Summarize CLI

命令行工具，用于分析 Claude Code sessions 并生成规则

Usage:
  ./summarize.ts [options]
  npm run summarize -- [options]

Options:
  --force              强制重新分析所有 sessions（忽略缓存）
  --session-dir <dir>  自定义 session 目录（默认：~/.claude/projects）
  --limit <n>          限制分析的 session 数量（用于测试）
  --min-confidence <n> 最低置信度阈值（默认：0.6）
  --dry-run            模拟运行，不保存结果
  --no-cleanup         跳过自动清理（合并重复规则等）
  --no-llm             禁用 LLM 增强（仅使用基础模式检测）
  --no-export          跳过导出到 claude-index.md
  --help, -h           显示帮助信息

Examples:
  # 基础用法（分析所有未分析的 sessions）
  ./summarize.ts

  # 强制重新分析所有 sessions
  ./summarize.ts --force

  # 只分析最近 5 个 sessions（测试）
  ./summarize.ts --limit 5

  # 禁用 LLM 增强（更快，但规则质量较低）
  ./summarize.ts --no-llm

  # 模拟运行，查看会发现什么但不保存
  ./summarize.ts --dry-run
`);
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  cliLogger.print('🚀 AutoImprove Summarize CLI\n');
  cliLogger.debug('CLI started', { options });

  try {
    // 1. Initialize storage
    cliLogger.print('📦 Initializing storage...');
    await initStorage();

    const indexManager = new RuleIndexManager();
    const existingRulesCount = indexManager.getAllRules().length;
    cliLogger.print(`   Found ${existingRulesCount} existing rules\n`);
    cliLogger.debug('Storage initialized', { existingRulesCount });

    // 2. Run batch rebuild
    cliLogger.print('📊 Starting batch analysis...');
    cliLogger.debug('Batch rebuild options', {
      force: options.force,
      incremental: !options.force,
      minConfidence: options.minConfidence,
      sessionLimit: options.limit,
      dryRun: options.dryRun,
      useLLM: !options.noLlm,
    });

    const batchEngine = new BatchRebuildEngine();

    const result = await batchEngine.rebuild({
      force: options.force,
      incremental: !options.force,
      minConfidence: options.minConfidence,
      sessionLimit: options.limit,
      dryRun: options.dryRun,
      sessionDir: options.sessionDir,
      enhancedRuleOptions: {
        useLLMEnhancement: !options.noLlm,
        extractCodeExamples: true,
      },
      autoCleanup: !options.noCleanup,
      mergeDuplicates: true,
      optimizeLowQuality: true,
      deleteVeryLowQuality: false,
      veryLowQualityThreshold: 0.3,
    });

    cliLogger.print('');
    cliLogger.print('📊 Analysis Results:');
    cliLogger.print(`   Sessions analyzed: ${result.sessions_analyzed || 0}`);
    cliLogger.print(`   Patterns detected: ${result.patterns_total || 0}`);
    cliLogger.print(`   Rules generated: ${result.rules_generated || 0}`);

    cliLogger.debug('Batch rebuild completed', {
      sessionsAnalyzed: result.sessions_analyzed,
      sessionsCached: result.sessions_cached,
      patternsTotal: result.patterns_total,
      patternsQualified: result.patterns_qualified,
      rulesGenerated: result.rules_generated,
      cacheHitRate: result.cache_hit_rate,
      executionTimeMs: result.execution_time_ms,
    });

    if (result.cleanup_performed) {
      cliLogger.print(`\n🧹 Cleanup Results:`);
      cliLogger.print(`   Rules merged: ${result.rules_merged || 0}`);
      cliLogger.print(`   Rules optimized: ${result.rules_optimized || 0}`);
      cliLogger.print(`   Rules deleted: ${result.rules_deleted || 0}`);

      cliLogger.debug('Cleanup completed', {
        merged: result.rules_merged,
        optimized: result.rules_optimized,
        deleted: result.rules_deleted,
      });
    }

    // 3. Export to claude-index.md (unless disabled)
    if (!options.noExport && !options.dryRun) {
      cliLogger.print('\n📤 Exporting to claude-index.md...');
      const contentManager = new RuleContentManager();
      const exporter = new ClaudeIndexExporter(indexManager, contentManager);

      const exportResult = exporter.export({
        strategy: 'category-balanced',
        limit: 10,
        minConfidence: options.minConfidence,
      });

      cliLogger.print(`   Exported ${exportResult.rulesExported} rules`);
      cliLogger.print(`   Location: ${exportResult.path}`);

      cliLogger.debug('Export completed', {
        rulesExported: exportResult.rulesExported,
        path: exportResult.path,
        tokenEstimate: exportResult.tokenEstimate,
      });
    }

    // 4. Summary
    cliLogger.print('\n✅ Summarize complete!');
    if (options.dryRun) {
      cliLogger.print('   (Dry run - no changes saved)');
    } else {
      // Reload index to get updated count
      const updatedIndexManager = new RuleIndexManager();
      const totalRules = updatedIndexManager.getAllRules().length;
      cliLogger.print(`   Total rules in database: ${totalRules}`);
      cliLogger.print(`   Rules auto-loaded into Claude: ~/.autoimprove/rules/claude-index.md`);

      cliLogger.debug('Summary', {
        totalRules,
        dryRun: options.dryRun,
      });

      // Close database connections
      updatedIndexManager.close();
    }

    // Close all database connections
    indexManager.close();
    batchEngine.cleanup();

    cliLogger.shutdown();

    // Force exit after a brief delay to ensure all resources are released
    setTimeout(() => {
      process.exit(0);
    }, 100);

  } catch (error) {
    cliLogger.error('\n❌ Error:', error instanceof Error ? error : undefined, {
      message: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Error && error.stack) {
      cliLogger.error('\nStack trace:');
      cliLogger.error(error.stack);
    }

    cliLogger.shutdown();
    process.exit(1);
  }
}

// Run
main().catch(error => {
  cliLogger.error('\n❌ Fatal error:', error instanceof Error ? error : undefined);
  cliLogger.shutdown();
  process.exit(1);
});
