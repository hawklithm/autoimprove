"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summarize = summarize;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const child_process_1 = require("child_process");
const logger_js_1 = require("../utils/logger.js");
async function summarize(options) {
    logger_js_1.cliLogger.print('=================================');
    logger_js_1.cliLogger.print('  AutoImprove Summarize');
    logger_js_1.cliLogger.print('=================================');
    logger_js_1.cliLogger.print('');
    const storageDir = (0, path_1.join)((0, os_1.homedir)(), '.autoimprove');
    // Check if initialized
    if (!(0, fs_1.existsSync)(storageDir)) {
        logger_js_1.cliLogger.error('❌ AutoImprove not initialized');
        logger_js_1.cliLogger.error('   Run: autoimprove setup');
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
    logger_js_1.cliLogger.print('Starting session analysis...');
    logger_js_1.cliLogger.print('');
    // Check if we have Claude Code available
    if (!await hasCommand('claude')) {
        logger_js_1.cliLogger.error('❌ Claude Code CLI not found');
        logger_js_1.cliLogger.error('   This command requires Claude Code to be installed');
        process.exit(1);
    }
    logger_js_1.cliLogger.print('Options:');
    logger_js_1.cliLogger.print(`  Analyze all sessions: ${options.all ? 'Yes' : 'No (unanalyzed only)'}`);
    logger_js_1.cliLogger.print(`  AI enhancement: ${options.enhance ? 'Yes' : 'No'}`);
    logger_js_1.cliLogger.print(`  Force reanalysis: ${options.force ? 'Yes' : 'No'}`);
    if (options.minConfidence !== undefined) {
        logger_js_1.cliLogger.print(`  Min confidence: ${options.minConfidence}`);
    }
    logger_js_1.cliLogger.print('');
    logger_js_1.cliLogger.print('This will invoke the AutoImprove skill within Claude Code.');
    logger_js_1.cliLogger.print('Please use the following command in Claude Code instead:');
    logger_js_1.cliLogger.print('');
    logger_js_1.cliLogger.print(`  /autoimprove-summarize${args.length > 0 ? ' ' + args.join(' ') : ''}`);
    logger_js_1.cliLogger.print('');
    logger_js_1.cliLogger.print('This ensures the analysis runs within the proper Claude Code context');
    logger_js_1.cliLogger.print('where it has access to session transcripts and can generate rules.');
    logger_js_1.cliLogger.print('');
}
async function hasCommand(command) {
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)('command', ['-v', command], { shell: true });
        proc.on('close', (code) => resolve(code === 0));
    });
}
//# sourceMappingURL=summarize.js.map