"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uninstall = uninstall;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const readline_1 = require("readline");
const logger_js_1 = require("../utils/logger.js");
/**
 * Uninstall AutoImprove — removes setup artifacts while preserving user data.
 *
 * Preserved: ~/.autoimprove/ (rules, sessions, config, cache, logs)
 * Removed:   MCP server config, skills, CLAUDE.md references, feedback instructions
 */
async function uninstall() {
    const removedFiles = [];
    const failedFiles = [];
    logger_js_1.cliLogger.print('==========================================');
    logger_js_1.cliLogger.print('  AutoImprove Uninstall');
    logger_js_1.cliLogger.print('==========================================');
    logger_js_1.cliLogger.print('');
    logger_js_1.cliLogger.print('This will remove AutoImprove configuration and');
    logger_js_1.cliLogger.print('system files while preserving your personal data');
    logger_js_1.cliLogger.print('(rules, sessions, learned patterns).');
    logger_js_1.cliLogger.print('');
    const storageDir = (0, path_1.join)((0, os_1.homedir)(), '.autoimprove');
    const claudeDir = (0, path_1.join)((0, os_1.homedir)(), '.claude');
    try {
        // -------------------------------------------------------
        // Step 1: Remove MCP Server configuration
        // -------------------------------------------------------
        logger_js_1.cliLogger.print('Step 1: Removing MCP Server configuration...');
        logger_js_1.cliLogger.print('---------------------------------------------');
        await removeMCPConfig('user', removedFiles, failedFiles);
        await removeMCPConfig('local', removedFiles, failedFiles);
        logger_js_1.cliLogger.print('');
        // -------------------------------------------------------
        // Step 2: Remove installed skills
        // -------------------------------------------------------
        logger_js_1.cliLogger.print('Step 2: Removing installed skills...');
        logger_js_1.cliLogger.print('---------------------------------------');
        const skillsDir = (0, path_1.join)(claudeDir, 'skills');
        const skillNames = [
            'autoimprove-status',
            'autoimprove-rules',
            'autoimprove-lessons',
            'autoimprove-summarize',
        ];
        for (const skill of skillNames) {
            const skillPath = (0, path_1.join)(skillsDir, skill);
            if ((0, fs_1.existsSync)(skillPath)) {
                try {
                    (0, fs_1.rmSync)(skillPath, { recursive: true, force: true });
                    removedFiles.push(skillPath);
                    logger_js_1.cliLogger.print(`  ✓ Removed skill: ${skill}`);
                }
                catch (error) {
                    failedFiles.push(skillPath);
                    logger_js_1.cliLogger.warn(`  ⚠ Failed to remove skill ${skill}: ${error.message}`);
                }
            }
            else {
                logger_js_1.cliLogger.print(`  - Skill not found: ${skill}`);
            }
        }
        logger_js_1.cliLogger.print('');
        // -------------------------------------------------------
        // Step 3: Clean CLAUDE.md
        // -------------------------------------------------------
        logger_js_1.cliLogger.print('Step 3: Cleaning CLAUDE.md...');
        logger_js_1.cliLogger.print('---------------------------------');
        await cleanClaudeMd(claudeDir, removedFiles, failedFiles);
        logger_js_1.cliLogger.print('');
        // -------------------------------------------------------
        // Step 3.5: Clean Codex configuration
        // -------------------------------------------------------
        logger_js_1.cliLogger.print('Step 3.5: Cleaning Codex configuration...');
        logger_js_1.cliLogger.print('-------------------------------------------');
        await cleanCodexConfig(removedFiles, failedFiles);
        logger_js_1.cliLogger.print('');
        // -------------------------------------------------------
        // Step 4: Remove feedback instructions file
        // -------------------------------------------------------
        logger_js_1.cliLogger.print('Step 4: Removing feedback instructions...');
        logger_js_1.cliLogger.print('-------------------------------------------');
        const feedbackPath = (0, path_1.join)(claudeDir, 'autoimprove-feedback-instructions.md');
        if ((0, fs_1.existsSync)(feedbackPath)) {
            try {
                (0, fs_1.rmSync)(feedbackPath, { force: true });
                removedFiles.push(feedbackPath);
                logger_js_1.cliLogger.print('  ✓ Removed feedback instructions');
            }
            catch (error) {
                failedFiles.push(feedbackPath);
                logger_js_1.cliLogger.warn(`  ⚠ Failed to remove feedback instructions: ${error.message}`);
            }
        }
        else {
            logger_js_1.cliLogger.print('  - Feedback instructions not found');
        }
        logger_js_1.cliLogger.print('');
        // -------------------------------------------------------
        // Step 5: Remove ONNX local ML (optional, requires confirmation)
        // -------------------------------------------------------
        logger_js_1.cliLogger.print('Step 5: ONNX local ML cleanup...');
        logger_js_1.cliLogger.print('-------------------------------------');
        const modelDir = (0, path_1.join)(storageDir, 'models');
        const mcpServerDir = (0, path_1.join)(getPackageRoot(), 'src/mcp-server-ts');
        const packageJsonPath = (0, path_1.join)(mcpServerDir, 'package.json');
        const hasOnnxDep = await checkOnnxDependency(packageJsonPath);
        const hasModelFiles = (0, fs_1.existsSync)(modelDir) && (0, fs_1.readdirSync)(modelDir).length > 0;
        if (hasOnnxDep || hasModelFiles) {
            logger_js_1.cliLogger.print('ONNX local ML 组件检测到：');
            if (hasOnnxDep) {
                logger_js_1.cliLogger.print('  • onnxruntime-node 依赖（MCP Server 的 package.json 中）');
            }
            if (hasModelFiles) {
                const modelFiles = (0, fs_1.readdirSync)(modelDir);
                for (const f of modelFiles) {
                    const fullPath = (0, path_1.join)(modelDir, f);
                    const stats = (0, fs_1.statSync)(fullPath);
                    const size = stats.isFile() ? ` (${(stats.size / 1024 / 1024).toFixed(1)}MB)` : '';
                    logger_js_1.cliLogger.print(`  • ${f}${size}`);
                }
            }
            logger_js_1.cliLogger.print('');
            const confirmed = await confirmPrompt('是否卸载 ONNX local ML 组件？（移除 onnxruntime-node 依赖和模型文件）[y/N] ');
            if (confirmed) {
                // Remove onnxruntime-node from package.json dependencies
                if (hasOnnxDep) {
                    try {
                        await removeOnnxDependency(packageJsonPath);
                        removedFiles.push(`${packageJsonPath} (removed onnxruntime-node dependency)`);
                        logger_js_1.cliLogger.print('  ✓ Removed onnxruntime-node from package.json');
                    }
                    catch (error) {
                        failedFiles.push(`${packageJsonPath} (onnxruntime-node dependency)`);
                        logger_js_1.cliLogger.warn(`  ⚠ Failed to remove onnxruntime-node dependency: ${error.message}`);
                    }
                }
                // Remove model files
                if (hasModelFiles) {
                    try {
                        const modelFiles = (0, fs_1.readdirSync)(modelDir);
                        for (const f of modelFiles) {
                            const fullPath = (0, path_1.join)(modelDir, f);
                            (0, fs_1.rmSync)(fullPath, { recursive: true, force: true });
                            removedFiles.push(fullPath);
                        }
                        logger_js_1.cliLogger.print(`  ✓ Removed ${modelFiles.length} model file(s) from ${modelDir}`);
                    }
                    catch (error) {
                        failedFiles.push(modelDir);
                        logger_js_1.cliLogger.warn(`  ⚠ Failed to remove model files: ${error.message}`);
                    }
                }
                // Remove node_modules/onnxruntime-node if present (orphaned dep)
                const onnxNodeModules = (0, path_1.join)(mcpServerDir, 'node_modules', 'onnxruntime-node');
                if ((0, fs_1.existsSync)(onnxNodeModules)) {
                    try {
                        (0, fs_1.rmSync)(onnxNodeModules, { recursive: true, force: true });
                        removedFiles.push(onnxNodeModules);
                        logger_js_1.cliLogger.print('  ✓ Removed onnxruntime-node from node_modules');
                    }
                    catch (error) {
                        failedFiles.push(onnxNodeModules);
                        logger_js_1.cliLogger.warn(`  ⚠ Failed to remove onnxruntime-node from node_modules: ${error.message}`);
                    }
                }
                logger_js_1.cliLogger.print('');
                logger_js_1.cliLogger.print('  ONNX local ML 已卸载。EmbeddingEncoder 将自动回退到');
                logger_js_1.cliLogger.print('  零依赖的 char-ngram-tfidf 模式，不影响系统正常运行。');
                logger_js_1.cliLogger.print('  如需重新安装，运行: bash scripts/install-onnx-models.sh');
            }
            else {
                logger_js_1.cliLogger.print('  - 已跳过 ONNX 组件卸载');
            }
        }
        else {
            logger_js_1.cliLogger.print('  - ONNX local ML 组件未安装，无需清理');
        }
        logger_js_1.cliLogger.print('');
        // -------------------------------------------------------
        // Summary
        // -------------------------------------------------------
        logger_js_1.cliLogger.print('==========================================');
        logger_js_1.cliLogger.print('  Uninstall Summary');
        logger_js_1.cliLogger.print('==========================================');
        logger_js_1.cliLogger.print('');
        if (removedFiles.length > 0) {
            logger_js_1.cliLogger.print('Removed files and directories:');
            logger_js_1.cliLogger.print('---------------------------------------------');
            for (const file of removedFiles) {
                logger_js_1.cliLogger.print(`  • ${file}`);
            }
            logger_js_1.cliLogger.print('');
        }
        if (failedFiles.length > 0) {
            logger_js_1.cliLogger.warn('Failed to remove (may need manual cleanup):');
            logger_js_1.cliLogger.print('---------------------------------------------');
            for (const file of failedFiles) {
                logger_js_1.cliLogger.warn(`  • ${file}`);
            }
            logger_js_1.cliLogger.print('');
        }
        if ((0, fs_1.existsSync)(storageDir)) {
            logger_js_1.cliLogger.print('Preserved personal data:');
            logger_js_1.cliLogger.print('---------------------------------------------');
            logger_js_1.cliLogger.print(`  • ${storageDir}/ (rules, sessions, config, etc.)`);
            logger_js_1.cliLogger.print('');
            // List preserved subdirectories for transparency
            const preservedItems = listDirectoryContents(storageDir);
            for (const item of preservedItems) {
                logger_js_1.cliLogger.print(`    ${item}`);
            }
            logger_js_1.cliLogger.print('');
        }
        logger_js_1.cliLogger.print('==========================================');
        logger_js_1.cliLogger.print('✅ Uninstall complete!');
        logger_js_1.cliLogger.print('==========================================');
        logger_js_1.cliLogger.print('');
        logger_js_1.cliLogger.print('Your personal data (rules, sessions, learned patterns)');
        logger_js_1.cliLogger.print('are preserved at:');
        logger_js_1.cliLogger.print(`  ${storageDir}`);
        logger_js_1.cliLogger.print('');
        logger_js_1.cliLogger.print('To completely remove all data (including personal data):');
        logger_js_1.cliLogger.print(`  rm -rf ${storageDir}`);
        logger_js_1.cliLogger.print('');
    }
    catch (error) {
        logger_js_1.cliLogger.error('');
        logger_js_1.cliLogger.error('❌ Uninstall failed:', error.message);
        logger_js_1.cliLogger.error('');
        process.exit(1);
    }
}
// -----------------------------------------------------------
// Helper: Remove MCP configuration at given scope
// -----------------------------------------------------------
async function removeMCPConfig(scope, removedFiles, failedFiles) {
    try {
        const checkResult = await runCommand('claude', ['mcp', 'get', 'autoimprove-core'], true);
        const scopeKey = `${scope} config`;
        if (checkResult.includes(scopeKey)) {
            await runCommand('claude', ['mcp', 'remove', 'autoimprove-core', '-s', scope], true);
            removedFiles.push(`claude mcp config (${scope}-scope): autoimprove-core`);
            logger_js_1.cliLogger.print(`  ✓ Removed MCP configuration (${scope}-scope)`);
        }
        else {
            logger_js_1.cliLogger.print(`  - No MCP configuration found (${scope}-scope)`);
        }
    }
    catch (error) {
        failedFiles.push(`claude mcp config (${scope}-scope): autoimprove-core`);
        logger_js_1.cliLogger.warn(`  ⚠ Failed to remove MCP configuration (${scope}-scope): ${error.message}`);
    }
}
// -----------------------------------------------------------
// Helper: Clean AutoImprove references from CLAUDE.md
// -----------------------------------------------------------
async function cleanClaudeMd(claudeDir, removedFiles, failedFiles) {
    const globalClaudeMd = (0, path_1.join)(claudeDir, 'CLAUDE.md');
    if (!(0, fs_1.existsSync)(globalClaudeMd)) {
        logger_js_1.cliLogger.print('  - CLAUDE.md not found, nothing to clean');
        return;
    }
    try {
        let content = (0, fs_1.readFileSync)(globalClaudeMd, 'utf-8');
        let changes = false;
        // 1. Remove the <!-- AUTOIMPROVE_START --> ... <!-- AUTOIMPROVE_END --> block (current format)
        const autoimproveBlockRegex = /<!-- AUTOIMPROVE_START -->[\s\S]*?<!-- AUTOIMPROVE_END -->\n*/g;
        if (autoimproveBlockRegex.test(content)) {
            content = content.replace(autoimproveBlockRegex, '');
            changes = true;
        }
        // 2. Remove the AutoImprove Learned Rules section (including @ reference) — legacy format
        const rulesSectionRegex = /\n## AutoImprove Learned Rules\n\n@~\/\.autoimprove\/rules\/claude-index\.md\n\n/g;
        if (rulesSectionRegex.test(content)) {
            content = content.replace(rulesSectionRegex, '');
            changes = true;
        }
        // 3. Remove the AutoImprove Rule Feedback section (including @ reference) — legacy format
        const feedbackSectionRegex = /\n## AutoImprove Rule Feedback\n\n@~\/\.claude\/autoimprove-feedback-instructions\.md\n\n/g;
        if (feedbackSectionRegex.test(content)) {
            content = content.replace(feedbackSectionRegex, '');
            changes = true;
        }
        // 4. Also handle cases where the section might be at the end without trailing newline
        const rulesSectionEndRegex = /\n## AutoImprove Learned Rules\n\n@~\/\.autoimprove\/rules\/claude-index\.md\s*/g;
        if (rulesSectionEndRegex.test(content)) {
            content = content.replace(rulesSectionEndRegex, '\n');
            changes = true;
        }
        const feedbackSectionEndRegex = /\n## AutoImprove Rule Feedback\n\n@~\/\.claude\/autoimprove-feedback-instructions\.md\s*/g;
        if (feedbackSectionEndRegex.test(content)) {
            content = content.replace(feedbackSectionEndRegex, '\n');
            changes = true;
        }
        // 5. Remove any remaining @ references to autoimprove paths
        const autoimproveRefRegex = /@~\/\.autoimprove\/[^\s]+\s*/g;
        if (autoimproveRefRegex.test(content)) {
            content = content.replace(autoimproveRefRegex, '');
            changes = true;
        }
        if (changes) {
            // Clean up multiple consecutive newlines
            content = content.replace(/\n{3,}/g, '\n\n');
            // Trim leading/trailing whitespace
            content = content.trim();
            if (content.length === 0) {
                // If CLAUDE.md is now empty, remove it
                (0, fs_1.rmSync)(globalClaudeMd, { force: true });
                removedFiles.push(globalClaudeMd);
                logger_js_1.cliLogger.print('  ✓ Removed empty CLAUDE.md');
            }
            else {
                (0, fs_1.writeFileSync)(globalClaudeMd, content + '\n');
                removedFiles.push(`${globalClaudeMd} (cleaned AutoImprove references)`);
                logger_js_1.cliLogger.print('  ✓ Cleaned AutoImprove references from CLAUDE.md');
            }
        }
        else {
            logger_js_1.cliLogger.print('  - No AutoImprove references found in CLAUDE.md');
        }
    }
    catch (error) {
        failedFiles.push(globalClaudeMd);
        logger_js_1.cliLogger.warn(`  ⚠ Failed to clean CLAUDE.md: ${error.message}`);
    }
}
// -----------------------------------------------------------
// Helper: Clean Codex configuration (MCP settings, skill, agents)
// -----------------------------------------------------------
async function cleanCodexConfig(removedFiles, failedFiles) {
    const codexDir = (0, path_1.join)((0, os_1.homedir)(), '.codex');
    const codexMcpSettings = (0, path_1.join)(codexDir, 'mcp_settings.json');
    const codexSkillDir = (0, path_1.join)(codexDir, 'skills', 'autoimprove');
    const codexSkillFile = (0, path_1.join)(codexSkillDir, 'SKILL.md');
    const codexAgentsDir = (0, path_1.join)(codexSkillDir, 'agents');
    const codexOpenaiYaml = (0, path_1.join)(codexAgentsDir, 'openai.yaml');
    // 1. Remove Codex skill directory
    if ((0, fs_1.existsSync)(codexSkillDir)) {
        try {
            (0, fs_1.rmSync)(codexSkillDir, { recursive: true, force: true });
            removedFiles.push(codexSkillDir);
            logger_js_1.cliLogger.print('  ✓ Removed Codex skill: ~/.codex/skills/autoimprove/');
        }
        catch (error) {
            failedFiles.push(codexSkillDir);
            logger_js_1.cliLogger.warn(`  ⚠ Failed to remove Codex skill: ${error.message}`);
        }
    }
    else {
        logger_js_1.cliLogger.print('  - Codex skill not found');
    }
    // 2. Remove autoimprove-core from Codex MCP settings
    if ((0, fs_1.existsSync)(codexMcpSettings)) {
        try {
            const settings = JSON.parse((0, fs_1.readFileSync)(codexMcpSettings, 'utf-8'));
            if (settings.mcpServers && settings.mcpServers['autoimprove-core']) {
                delete settings.mcpServers['autoimprove-core'];
                // If mcpServers is now empty, clean it up
                if (Object.keys(settings.mcpServers).length === 0) {
                    delete settings.mcpServers;
                }
                (0, fs_1.writeFileSync)(codexMcpSettings, JSON.stringify(settings, null, 2) + '\n');
                removedFiles.push(`${codexMcpSettings} (removed autoimprove-core)`);
                logger_js_1.cliLogger.print('  ✓ Removed autoimprove-core from Codex MCP settings');
            }
            else {
                logger_js_1.cliLogger.print('  - No autoimprove-core in Codex MCP settings');
            }
        }
        catch (error) {
            failedFiles.push(codexMcpSettings);
            logger_js_1.cliLogger.warn(`  ⚠ Failed to clean Codex MCP settings: ${error.message}`);
        }
    }
    else {
        logger_js_1.cliLogger.print('  - Codex MCP settings not found');
    }
}
// -----------------------------------------------------------
// Helper: List contents of a directory (non-recursive)
// -----------------------------------------------------------
function listDirectoryContents(dir, prefix = '') {
    const items = [];
    if (!(0, fs_1.existsSync)(dir)) {
        return items;
    }
    try {
        const entries = (0, fs_1.readdirSync)(dir);
        for (const entry of entries) {
            const fullPath = (0, path_1.join)(dir, entry);
            const stats = (0, fs_1.statSync)(fullPath);
            if (stats.isDirectory()) {
                items.push(`${prefix}📁 ${entry}/`);
            }
            else {
                items.push(`${prefix}📄 ${entry}`);
            }
        }
    }
    catch {
        // Ignore errors listing directory
    }
    return items;
}
// -----------------------------------------------------------
// Helper: Run a shell command and capture output
// -----------------------------------------------------------
async function runCommand(command, args, ignoreError = false) {
    return new Promise((resolve, reject) => {
        const proc = (0, child_process_1.spawn)(command, args, { stdio: 'pipe' });
        let output = '';
        let error = '';
        proc.stdout.on('data', (data) => (output += data));
        proc.stderr.on('data', (data) => (error += data));
        proc.on('close', (code) => {
            if (code !== 0 && !ignoreError) {
                reject(new Error(error || output));
            }
            else {
                resolve(output);
            }
        });
    });
}
// -----------------------------------------------------------
// Helper: Interactive confirmation prompt
// -----------------------------------------------------------
function confirmPrompt(question) {
    return new Promise((resolve) => {
        const rl = (0, readline_1.createInterface)({
            input: process.stdin,
            output: process.stdout,
        });
        rl.question(question, (answer) => {
            rl.close();
            const normalized = answer.trim().toLowerCase();
            resolve(normalized === 'y' || normalized === 'yes');
        });
    });
}
// -----------------------------------------------------------
// Helper: Check if package.json has onnxruntime-node dependency
// -----------------------------------------------------------
async function checkOnnxDependency(packageJsonPath) {
    if (!(0, fs_1.existsSync)(packageJsonPath))
        return false;
    try {
        const content = JSON.parse((0, fs_1.readFileSync)(packageJsonPath, 'utf-8'));
        const deps = { ...content.dependencies, ...content.devDependencies };
        return Object.keys(deps).some(k => k === 'onnxruntime-node');
    }
    catch {
        return false;
    }
}
// -----------------------------------------------------------
// Helper: Remove onnxruntime-node from package.json dependencies
// -----------------------------------------------------------
async function removeOnnxDependency(packageJsonPath) {
    const content = JSON.parse((0, fs_1.readFileSync)(packageJsonPath, 'utf-8'));
    if (content.dependencies) {
        delete content.dependencies['onnxruntime-node'];
        if (Object.keys(content.dependencies).length === 0) {
            delete content.dependencies;
        }
    }
    if (content.devDependencies) {
        delete content.devDependencies['onnxruntime-node'];
        if (Object.keys(content.devDependencies).length === 0) {
            delete content.devDependencies;
        }
    }
    (0, fs_1.writeFileSync)(packageJsonPath, JSON.stringify(content, null, 2) + '\n');
}
// -----------------------------------------------------------
// Helper: Get package root by looking for package.json
// -----------------------------------------------------------
function getPackageRoot() {
    let current = __dirname;
    while (current !== '/') {
        if ((0, fs_1.existsSync)((0, path_1.join)(current, 'package.json'))) {
            return current;
        }
        current = (0, path_1.join)(current, '..');
    }
    // Fallback to CWD if not found (e.g., running from source)
    return process.cwd();
}
//# sourceMappingURL=uninstall.js.map