import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
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

  // Build arguments for the skill invocation
  const args: string[] = [];

  if (options.all) {
    args.push('--all');
  }

  if (options.enhance) {
    args.push('--enhance');
  }

  if (options.force) {
    args.push('--force');
  }

  if (options.minConfidence !== undefined) {
    args.push('--min-confidence', options.minConfidence.toString());
  }

  cliLogger.print('Starting session analysis...');
  cliLogger.print('');

  // Check if we have Claude Code available
  if (!await hasCommand('claude')) {
    cliLogger.error('❌ Claude Code CLI not found');
    cliLogger.error('   This command requires Claude Code to be installed');
    process.exit(1);
  }

  cliLogger.print('Options:');
  cliLogger.print(`  Analyze all sessions: ${options.all ? 'Yes' : 'No (unanalyzed only)'}`);
  cliLogger.print(`  AI enhancement: ${options.enhance ? 'Yes' : 'No'}`);
  cliLogger.print(`  Force reanalysis: ${options.force ? 'Yes' : 'No'}`);
  if (options.minConfidence !== undefined) {
    cliLogger.print(`  Min confidence: ${options.minConfidence}`);
  }
  cliLogger.print('');

  cliLogger.print('This will invoke the AutoImprove skill within Claude Code.');
  cliLogger.print('Please use the following command in Claude Code instead:');
  cliLogger.print('');
  cliLogger.print(`  /autoimprove-summarize${args.length > 0 ? ' ' + args.join(' ') : ''}`);
  cliLogger.print('');
  cliLogger.print('This ensures the analysis runs within the proper Claude Code context');
  cliLogger.print('where it has access to session transcripts and can generate rules.');
  cliLogger.print('');
}

async function hasCommand(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('command', ['-v', command], { shell: true });
    proc.on('close', (code) => resolve(code === 0));
  });
}
