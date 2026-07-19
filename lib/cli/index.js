#!/usr/bin/env node
import { Command } from 'commander';
import { setup } from './commands/setup.js';
import { uninstall } from './commands/uninstall.js';
import { status } from './commands/status.js';
import { summarize } from './commands/summarize.js';
import { rules } from './commands/rules.js';
const program = new Command();
program
    .name('autoimprove')
    .description('Learn coding patterns from Claude Code sessions and generate reusable rules')
    .version('0.2.0');
program
    .command('setup')
    .description('Install and configure AutoImprove MCP server and skills')
    .option('--force', 'Force reinstall even if already configured')
    .action(setup);
program
    .command('uninstall')
    .description('Remove AutoImprove configuration while preserving personal data (rules, sessions)')
    .action(uninstall);
program
    .command('status')
    .description('Check AutoImprove system health and statistics')
    .action(status);
program
    .command('summarize')
    .description('Analyze Claude Code sessions and generate rules')
    .option('--all', 'Analyze all historical sessions (same as --force)')
    .option('--enhance', 'Use AI enhancement for better rule quality (enabled by default)')
    .option('--force', 'Force reanalysis of already-analyzed sessions')
    .option('--min-confidence <number>', 'Minimum confidence threshold (0-1)', parseFloat)
    .option('--limit <number>', 'Limit number of sessions to analyze (for testing)', parseInt)
    .option('--dry-run', 'Preview without saving any changes')
    .option('--no-cleanup', 'Skip automatic rule cleanup (merge duplicates, etc.)')
    .option('--no-llm', 'Disable LLM enhancement (basic pattern detection only)')
    .option('--no-export', 'Skip exporting rules to claude-index.md')
    .option('--session-dir <dir>', 'Custom session directory (default: ~/.claude/projects)')
    .action(summarize);
program
    .command('rules')
    .description('View and manage knowledge rules')
    .option('--category <type>', 'Filter by category (security, performance, preference, etc.)')
    .option('--min-confidence <number>', 'Minimum confidence threshold (0-1)', parseFloat)
    .option('--priority <level>', 'Filter by priority (critical, high, medium, low)')
    .action(rules);
program.parse();
//# sourceMappingURL=index.js.map