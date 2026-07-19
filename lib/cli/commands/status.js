import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import { cliLogger } from '../utils/logger.js';
export async function status() {
    cliLogger.print('=================================');
    cliLogger.print('  AutoImprove Status');
    cliLogger.print('=================================');
    cliLogger.print('');
    const storageDir = join(homedir(), '.autoimprove');
    const claudeDir = join(homedir(), '.claude');
    // Check storage
    cliLogger.print('Storage:');
    cliLogger.print('-----------------------------------');
    if (existsSync(storageDir)) {
        cliLogger.print(`✓ Storage directory: ${storageDir}`);
        const rulesIndexPath = join(storageDir, 'rules/index.json');
        if (existsSync(rulesIndexPath)) {
            const rulesIndex = JSON.parse(readFileSync(rulesIndexPath, 'utf-8'));
            cliLogger.print(`✓ Rules: ${rulesIndex.rules.length} total`);
            // Count by priority
            const priorities = { critical: 0, high: 0, medium: 0, low: 0 };
            for (const rule of rulesIndex.rules) {
                const priority = rule.priority || 'low';
                priorities[priority]++;
            }
            cliLogger.print(`  - 🔴 Critical: ${priorities.critical}`);
            cliLogger.print(`  - 🟠 High: ${priorities.high}`);
            cliLogger.print(`  - 🟡 Medium: ${priorities.medium}`);
            cliLogger.print(`  - ⚪ Low: ${priorities.low}`);
        }
        else {
            cliLogger.print('⚠ Rules index not found');
        }
        const sessionsDir = join(storageDir, 'sessions');
        if (existsSync(sessionsDir)) {
            const sessions = readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
            cliLogger.print(`✓ Sessions: ${sessions.length} tracked`);
        }
    }
    else {
        cliLogger.print('❌ Storage not initialized');
        cliLogger.print('   Run: autoimprove setup');
    }
    cliLogger.print('');
    // Check MCP Server
    cliLogger.print('MCP Server:');
    cliLogger.print('-----------------------------------');
    try {
        const mcpStatus = await runCommand('claude', ['mcp', 'get', 'autoimprove-core']);
        if (mcpStatus.includes('user config')) {
            cliLogger.print('✓ Registered (user-level)');
            // Extract path from status
            const pathMatch = mcpStatus.match(/command:\s*node\s+(.+)/);
            if (pathMatch) {
                const serverPath = pathMatch[1];
                cliLogger.print(`  Path: ${serverPath}`);
                if (existsSync(serverPath)) {
                    cliLogger.print('  ✓ Server file exists');
                }
                else {
                    cliLogger.print('  ⚠ Server file not found');
                }
            }
        }
        else {
            cliLogger.print('❌ Not registered');
            cliLogger.print('   Run: autoimprove setup');
        }
    }
    catch (error) {
        cliLogger.print('❌ Failed to check MCP status');
        cliLogger.print(`   ${error.message}`);
    }
    cliLogger.print('');
    // Check Skills
    cliLogger.print('Skills:');
    cliLogger.print('-----------------------------------');
    const skillsDir = join(claudeDir, 'skills');
    const expectedSkills = [
        'autoimprove-status',
        'autoimprove-rules',
        'autoimprove-lessons',
    ];
    let installedCount = 0;
    for (const skill of expectedSkills) {
        const skillPath = join(skillsDir, skill, 'SKILL.md');
        if (existsSync(skillPath)) {
            cliLogger.print(`✓ /${skill.replace('autoimprove-', '')}`);
            installedCount++;
        }
        else {
            cliLogger.print(`❌ /${skill.replace('autoimprove-', '')}`);
        }
    }
    if (installedCount === 0) {
        cliLogger.print('⚠ No skills installed');
        cliLogger.print('   Run: autoimprove setup');
    }
    cliLogger.print('');
    // Check Claude.md
    cliLogger.print('Configuration:');
    cliLogger.print('-----------------------------------');
    const globalClaudeMd = join(claudeDir, 'CLAUDE.md');
    if (existsSync(globalClaudeMd)) {
        const content = readFileSync(globalClaudeMd, 'utf-8');
        if (content.includes('autoimprove/rules/claude-index.md')) {
            cliLogger.print('✓ Rules reference configured in CLAUDE.md');
        }
        else {
            cliLogger.print('⚠ Rules reference missing from CLAUDE.md');
            cliLogger.print('   Run: autoimprove setup --force');
        }
        if (content.includes('autoimprove-feedback-instructions.md')) {
            cliLogger.print('✓ Feedback instructions configured');
        }
        else {
            cliLogger.print('⚠ Feedback instructions missing');
            cliLogger.print('   Run: autoimprove setup --force');
        }
    }
    else {
        cliLogger.print('⚠ CLAUDE.md not found');
        cliLogger.print('   Will be created on setup');
    }
    cliLogger.print('');
    // Overall status
    const hasStorage = existsSync(storageDir);
    const hasMCP = await checkMCPRegistered();
    const hasSkills = installedCount > 0;
    if (hasStorage && hasMCP && hasSkills) {
        cliLogger.print('=================================');
        cliLogger.print('✅ System is operational');
        cliLogger.print('=================================');
    }
    else {
        cliLogger.print('=================================');
        cliLogger.print('⚠ System needs setup');
        cliLogger.print('=================================');
        cliLogger.print('');
        cliLogger.print('Run: autoimprove setup');
    }
    cliLogger.print('');
}
async function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { stdio: 'pipe' });
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