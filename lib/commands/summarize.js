"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarize = summarize;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const child_process_1 = require("child_process");
async function summarize(options) {
    console.log('=================================');
    console.log('  AutoImprove Summarize');
    console.log('=================================');
    console.log('');
    const storageDir = (0, path_1.join)((0, os_1.homedir)(), '.autoimprove');
    // Check if initialized
    if (!(0, fs_1.existsSync)(storageDir)) {
        console.error('❌ AutoImprove not initialized');
        console.error('   Run: autoimprove setup');
        process.exit(1);
    }
    // Build arguments for the skill invocation
    const args = [];
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
async function hasCommand(command) {
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)('command', ['-v', command], { shell: true });
        proc.on('close', (code) => resolve(code === 0));
    });
}
//# sourceMappingURL=summarize.js.map