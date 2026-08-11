import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { cliLogger } from '../utils/logger.js';

interface SummarizeOptions {
  all?: boolean;
  enhance?: boolean;
  force?: boolean;
  minConfidence?: number;
  limit?: number;
  dryRun?: boolean;
  noCleanup?: boolean;
  noLlm?: boolean;
  noExport?: boolean;
  sessionDir?: string;
}

export async function summarize(options: SummarizeOptions) {
  cliLogger.print('=================================');
  cliLogger.print('  AutoImprove Summarize');
  cliLogger.print('=================================');
  cliLogger.print('');

  const storageDir = join(homedir(), '.autoimprove');

  // Check if initialized
  if (!existsSync(storageDir)) {
    cliLogger.error('❌ AutoImprove not initialized');
    cliLogger.error('   Run: autoimprove setup');
    process.exit(1);
  }

  cliLogger.print('Starting session analysis...');
  cliLogger.print('');

  cliLogger.print('Options:');
  cliLogger.print(`  Force reanalysis: ${(options.force || options.all) ? 'Yes' : 'No (unanalyzed only)'}`);
  cliLogger.print(`  AI enhancement: ${options.noLlm ? 'No' : 'Yes'}`);
  if (options.minConfidence !== undefined) {
    cliLogger.print(`  Min confidence: ${options.minConfidence}`);
  }
  if (options.limit !== undefined) {
    cliLogger.print(`  Session limit: ${options.limit}`);
  }
  if (options.dryRun) {
    cliLogger.print(`  Mode: Dry run (no changes saved)`);
  }
  if (options.sessionDir) {
    cliLogger.print(`  Session dir: ${options.sessionDir}`);
  }
  cliLogger.print('');

  // Dynamically import the summarize engine from the CLI utils
  const pkgRoot = getPackageRoot();
  const enginePath = join(pkgRoot, 'lib', 'utils', 'summarize-engine.js');

  cliLogger.print('Running session analysis...');
  cliLogger.print('');

  try {
    const { runSummarize } = await import(pathToFileURL(enginePath).href);

    await runSummarize({
      force: !!(options.force || options.all),
      sessionDir: options.sessionDir || join(homedir(), '.claude', 'projects'),
      limit: options.limit,
      minConfidence: options.minConfidence ?? 0.6,
      dryRun: !!options.dryRun,
      noCleanup: !!options.noCleanup,
      // Commander sets `noLlm` to true only when --no-llm is supplied.
      // `--enhance` is documented as enabled by default, so an omitted
      // --enhance flag must not accidentally disable LLM enhancement.
      noLlm: !!options.noLlm,
      noExport: !!options.noExport,
    });

    // Force exit after a brief delay to ensure all resources are released
    setTimeout(() => {
      process.exit(0);
    }, 100);
  } catch (error) {
    cliLogger.error('\n❌ Summarize failed:',
      error instanceof Error ? error : undefined,
      { message: error instanceof Error ? error.message : String(error) }
    );

    if (error instanceof Error && error.stack) {
      cliLogger.error('\nStack trace:');
      cliLogger.error(error.stack);
    }

    process.exit(1);
  }
}

/**
 * Get the package root directory by searching up from the current file.
 */
function getPackageRoot(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  let current = __dirname;
  while (current !== '/') {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    current = join(current, '..');
  }
  // Fallback to CWD if not found (e.g., running from source)
  return process.cwd();
}
