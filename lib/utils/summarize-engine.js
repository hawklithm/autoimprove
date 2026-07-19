/**
 * Summarize Engine
 *
 * Core logic extracted from summarize.ts for reuse in the unified CLI.
 * Performs: init storage → batch rebuild → export → print results.
 *
 * This module uses dynamic imports because the MCP server code is compiled
 * separately (src/mcp-server-ts/dist/) from the CLI code (lib/). We resolve
 * paths relative to the package root at runtime.
 */
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cliLogger } from './cli-logger.js';
/**
 * Get the package root directory by searching up from the current file.
 */
function getPackageRoot() {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    let current = __dirname;
    while (current !== '/') {
        if (existsSync(join(current, 'package.json'))) {
            return current;
        }
        current = join(current, '..');
    }
    return process.cwd();
}
export async function runSummarize(options) {
    cliLogger.print('🚀 AutoImprove Summarize CLI\n');
    cliLogger.debug('CLI started', { options });
    const pkgRoot = getPackageRoot();
    // Dynamically import MCP server modules from the compiled dist
    const mcpDist = join(pkgRoot, 'src', 'mcp-server-ts', 'dist');
    const [{ initStorage }, { RuleIndexManager }, { RuleContentManager }, { BatchRebuildEngine }, { ClaudeIndexExporter },] = await Promise.all([
        import(join(mcpDist, 'storage', 'init.js')),
        import(join(mcpDist, 'storage', 'rule-index.js')),
        import(join(mcpDist, 'storage', 'rule-content.js')),
        import(join(mcpDist, 'core', 'batch-rebuild.js')),
        import(join(mcpDist, 'tools', 'export-rules-to-claude.js')),
    ]);
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
    }
    else {
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
}
//# sourceMappingURL=summarize-engine.js.map