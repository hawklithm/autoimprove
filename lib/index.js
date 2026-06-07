#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const setup_1 = require("./commands/setup");
const status_1 = require("./commands/status");
const summarize_1 = require("./commands/summarize");
const rules_1 = require("./commands/rules");
const program = new commander_1.Command();
program
    .name('autoimprove')
    .description('Learn coding patterns from Claude Code sessions and generate reusable rules')
    .version('0.2.0');
program
    .command('setup')
    .description('Install and configure AutoImprove MCP server and skills')
    .option('--force', 'Force reinstall even if already configured')
    .action(setup_1.setup);
program
    .command('status')
    .description('Check AutoImprove system health and statistics')
    .action(status_1.status);
program
    .command('summarize')
    .description('Analyze Claude Code sessions and generate rules')
    .option('--all', 'Analyze all historical sessions')
    .option('--enhance', 'Use AI enhancement for better rule quality')
    .option('--force', 'Force reanalysis of already-analyzed sessions')
    .option('--min-confidence <number>', 'Minimum confidence threshold (0-1)', parseFloat)
    .action(summarize_1.summarize);
program
    .command('rules')
    .description('View and manage knowledge rules')
    .option('--category <type>', 'Filter by category (security, performance, preference, etc.)')
    .option('--min-confidence <number>', 'Minimum confidence threshold (0-1)', parseFloat)
    .option('--priority <level>', 'Filter by priority (critical, high, medium, low)')
    .action(rules_1.rules);
program.parse();
//# sourceMappingURL=index.js.map