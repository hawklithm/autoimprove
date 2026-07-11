"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.status = status;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const child_process_1 = require("child_process");
const logger_js_1 = require("../utils/logger.js");
async function status() {
    logger_js_1.cliLogger.print('=================================');
    logger_js_1.cliLogger.print('  AutoImprove Status');
    logger_js_1.cliLogger.print('=================================');
    logger_js_1.cliLogger.print('');
    const storageDir = (0, path_1.join)((0, os_1.homedir)(), '.autoimprove');
    const claudeDir = (0, path_1.join)((0, os_1.homedir)(), '.claude');
    // Check storage
    logger_js_1.cliLogger.print('Storage:');
    logger_js_1.cliLogger.print('-----------------------------------');
    if ((0, fs_1.existsSync)(storageDir)) {
        logger_js_1.cliLogger.print(`✓ Storage directory: ${storageDir}`);
        const rulesIndexPath = (0, path_1.join)(storageDir, 'rules/index.json');
        if ((0, fs_1.existsSync)(rulesIndexPath)) {
            const rulesIndex = JSON.parse((0, fs_1.readFileSync)(rulesIndexPath, 'utf-8'));
            logger_js_1.cliLogger.print(`✓ Rules: ${rulesIndex.rules.length} total`);
            // Count by priority
            const priorities = { critical: 0, high: 0, medium: 0, low: 0 };
            for (const rule of rulesIndex.rules) {
                const priority = rule.priority || 'low';
                priorities[priority]++;
            }
            logger_js_1.cliLogger.print(`  - 🔴 Critical: ${priorities.critical}`);
            logger_js_1.cliLogger.print(`  - 🟠 High: ${priorities.high}`);
            logger_js_1.cliLogger.print(`  - 🟡 Medium: ${priorities.medium}`);
            logger_js_1.cliLogger.print(`  - ⚪ Low: ${priorities.low}`);
        }
        else {
            logger_js_1.cliLogger.print('⚠ Rules index not found');
        }
        const sessionsDir = (0, path_1.join)(storageDir, 'sessions');
        if ((0, fs_1.existsSync)(sessionsDir)) {
            const sessions = require('fs').readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
            logger_js_1.cliLogger.print(`✓ Sessions: ${sessions.length} tracked`);
        }
    }
    else {
        logger_js_1.cliLogger.print('❌ Storage not initialized');
        logger_js_1.cliLogger.print('   Run: autoimprove setup');
    }
    logger_js_1.cliLogger.print('');
    // Check MCP Server
    logger_js_1.cliLogger.print('MCP Server:');
    logger_js_1.cliLogger.print('-----------------------------------');
    try {
        const mcpStatus = await runCommand('claude', ['mcp', 'get', 'autoimprove-core']);
        if (mcpStatus.includes('user config')) {
            logger_js_1.cliLogger.print('✓ Registered (user-level)');
            // Extract path from status
            const pathMatch = mcpStatus.match(/command:\s*node\s+(.+)/);
            if (pathMatch) {
                const serverPath = pathMatch[1];
                logger_js_1.cliLogger.print(`  Path: ${serverPath}`);
                if ((0, fs_1.existsSync)(serverPath)) {
                    logger_js_1.cliLogger.print('  ✓ Server file exists');
                }
                else {
                    logger_js_1.cliLogger.print('  ⚠ Server file not found');
                }
            }
        }
        else {
            logger_js_1.cliLogger.print('❌ Not registered');
            logger_js_1.cliLogger.print('   Run: autoimprove setup');
        }
    }
    catch (error) {
        logger_js_1.cliLogger.print('❌ Failed to check MCP status');
        logger_js_1.cliLogger.print(`   ${error.message}`);
    }
    logger_js_1.cliLogger.print('');
    // Check Skills
    logger_js_1.cliLogger.print('Skills:');
    logger_js_1.cliLogger.print('-----------------------------------');
    const skillsDir = (0, path_1.join)(claudeDir, 'skills');
    const expectedSkills = [
        'autoimprove-status',
        'autoimprove-rules',
        'autoimprove-lessons',
        'autoimprove-summarize'
    ];
    let installedCount = 0;
    for (const skill of expectedSkills) {
        const skillPath = (0, path_1.join)(skillsDir, skill, 'SKILL.md');
        if ((0, fs_1.existsSync)(skillPath)) {
            logger_js_1.cliLogger.print(`✓ /${skill.replace('autoimprove-', '')}`);
            installedCount++;
        }
        else {
            logger_js_1.cliLogger.print(`❌ /${skill.replace('autoimprove-', '')}`);
        }
    }
    if (installedCount === 0) {
        logger_js_1.cliLogger.print('⚠ No skills installed');
        logger_js_1.cliLogger.print('   Run: autoimprove setup');
    }
    logger_js_1.cliLogger.print('');
    // Check Claude.md
    logger_js_1.cliLogger.print('Configuration:');
    logger_js_1.cliLogger.print('-----------------------------------');
    const globalClaudeMd = (0, path_1.join)(claudeDir, 'CLAUDE.md');
    if ((0, fs_1.existsSync)(globalClaudeMd)) {
        const content = (0, fs_1.readFileSync)(globalClaudeMd, 'utf-8');
        if (content.includes('autoimprove/rules/claude-index.md')) {
            logger_js_1.cliLogger.print('✓ Rules reference configured in CLAUDE.md');
        }
        else {
            logger_js_1.cliLogger.print('⚠ Rules reference missing from CLAUDE.md');
            logger_js_1.cliLogger.print('   Run: autoimprove setup --force');
        }
        if (content.includes('autoimprove-feedback-instructions.md')) {
            logger_js_1.cliLogger.print('✓ Feedback instructions configured');
        }
        else {
            logger_js_1.cliLogger.print('⚠ Feedback instructions missing');
            logger_js_1.cliLogger.print('   Run: autoimprove setup --force');
        }
    }
    else {
        logger_js_1.cliLogger.print('⚠ CLAUDE.md not found');
        logger_js_1.cliLogger.print('   Will be created on setup');
    }
    logger_js_1.cliLogger.print('');
    // Overall status
    const hasStorage = (0, fs_1.existsSync)(storageDir);
    const hasMCP = await checkMCPRegistered();
    const hasSkills = installedCount > 0;
    if (hasStorage && hasMCP && hasSkills) {
        logger_js_1.cliLogger.print('=================================');
        logger_js_1.cliLogger.print('✅ System is operational');
        logger_js_1.cliLogger.print('=================================');
    }
    else {
        logger_js_1.cliLogger.print('=================================');
        logger_js_1.cliLogger.print('⚠ System needs setup');
        logger_js_1.cliLogger.print('=================================');
        logger_js_1.cliLogger.print('');
        logger_js_1.cliLogger.print('Run: autoimprove setup');
    }
    logger_js_1.cliLogger.print('');
}
async function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)(command, args, { stdio: 'pipe' });
        let output = '';
        let error = '';
        proc.stdout.on('data', (data) => output += data);
        proc.stderr.on('data', (data) => error += data);
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(error || output));
            }
            else {
                resolve(output);
            }
        });
    });
}
async function checkMCPRegistered() {
    try {
        const result = await runCommand('claude', ['mcp', 'get', 'autoimprove-core']);
        return result.includes('user config');
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=status.js.map