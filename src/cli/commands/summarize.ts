import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { cliLogger } from '../utils/logger.js';

interface SummarizeOptions {
  all?: boolean;
  enhance?: boolean;
  force?: boolean;
  minConfidence?: number;
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
  cliLogger.print(`  Analyze all sessions: ${options.all ? 'Yes' : 'No (unanalyzed only)'}`);
  cliLogger.print(`  AI enhancement: ${options.enhance ? 'Yes' : 'No'}`);
  cliLogger.print(`  Force reanalysis: ${options.force ? 'Yes' : 'No'}`);
  if (options.minConfidence !== undefined) {
    cliLogger.print(`  Min confidence: ${options.minConfidence}`);
  }
  cliLogger.print('');

  // Invoke the summarize script directly
  const rootDir = getPackageRoot();
  const scriptPath = join(rootDir, 'summarize.ts');
  const summarizeArgs = ['tsx', scriptPath];

  if (options.force) {
    summarizeArgs.push('--force');
  }

  if (options.minConfidence !== undefined) {
    summarizeArgs.push('--min-confidence', options.minConfidence.toString());
  }

  cliLogger.print('Running summarize script...');
  cliLogger.print('');

  const proc = spawn('npx', summarizeArgs, {
    stdio: 'inherit',
    env: { ...process.env },
  });

  proc.on('close', (code) => {
    if (code !== 0) {
      cliLogger.error(`❌ Summarize failed with exit code ${code}`);
      process.exit(code || 1);
    }
  });
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
