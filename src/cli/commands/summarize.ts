import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

interface SummarizeOptions {
  all?: boolean;
  enhance?: boolean;
  force?: boolean;
  minConfidence?: number;
}

export async function summarize(options: SummarizeOptions) {
  console.log('=================================');
  console.log('  AutoImprove Summarize');
  console.log('=================================');
  console.log('');

  const storageDir = join(homedir(), '.autoimprove');

  // Check if initialized
  if (!existsSync(storageDir)) {
    console.error('❌ AutoImprove not initialized');
    console.error('   Run: autoimprove setup');
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

  console.log('Starting session analysis...');
  console.log('');

  // Check if we have Claude Code available
  if (!await hasCommand('claude')) {
    console.error('❌ Claude Code CLI not found');
    console.error('   This command requires Claude Code to be installed');
    process.exit(1);
  }

  console.log('Options:');
  console.log(`  Analyze all sessions: ${options.all ? 'Yes' : 'No (unanalyzed only)'}`);
  console.log(`  AI enhancement: ${options.enhance ? 'Yes' : 'No'}`);
  console.log(`  Force reanalysis: ${options.force ? 'Yes' : 'No'}`);
  if (options.minConfidence !== undefined) {
    console.log(`  Min confidence: ${options.minConfidence}`);
  }
  console.log('');

  console.log('This will invoke the AutoImprove skill within Claude Code.');
  console.log('Please use the following command in Claude Code instead:');
  console.log('');
  console.log(`  /autoimprove-summarize${args.length > 0 ? ' ' + args.join(' ') : ''}`);
  console.log('');
  console.log('This ensures the analysis runs within the proper Claude Code context');
  console.log('where it has access to session transcripts and can generate rules.');
  console.log('');
}

async function hasCommand(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('command', ['-v', command], { shell: true });
    proc.on('close', (code) => resolve(code === 0));
  });
}
