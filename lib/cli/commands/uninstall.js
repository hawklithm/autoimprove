import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { createInterface } from 'readline';
import { cliLogger } from '../utils/logger.js';
/**
 * Uninstall AutoImprove — removes setup artifacts while preserving user data.
 *
 * Preserved: ~/.autoimprove/ (rules, sessions, config, cache, logs)
 * Removed:   MCP server config, skills, CLAUDE.md references, feedback instructions
 */
export async function uninstall() {
    const removedFiles = [];
    const failedFiles = [];
    cliLogger.print('==========================================');
    cliLogger.print('  AutoImprove Uninstall');
    cliLogger.print('==========================================');
    cliLogger.print('');
    cliLogger.print('This will remove AutoImprove configuration and');
    cliLogger.print('system files while preserving your personal data');
    cliLogger.print('(rules, sessions, learned patterns).');
    cliLogger.print('');
    const storageDir = join(homedir(), '.autoimprove');
    const claudeDir = join(homedir(), '.claude');
    try {
        // -------------------------------------------------------
        // Step 1: Remove MCP Server configuration
        // -------------------------------------------------------
        cliLogger.print('Step 1: Removing MCP Server configuration...');
        cliLogger.print('---------------------------------------------');
        await removeMCPConfig('user', removedFiles, failedFiles);
        await removeMCPConfig('local', removedFiles, failedFiles);
        cliLogger.print('');
        // -------------------------------------------------------
        // Step 2: Remove installed skills
        // -------------------------------------------------------
        cliLogger.print('Step 2: Removing installed skills...');
        cliLogger.print('---------------------------------------');
        const skillsDir = join(claudeDir, 'skills');
        const skillNames = [
            'autoimprove-status',
            'autoimprove-rules',
            'autoimprove-lessons',
            'autoimprove-check',
            'autoimprove-summarize',
        ];
        for (const skill of skillNames) {
            const skillPath = join(skillsDir, skill);
            if (existsSync(skillPath)) {
                try {
                    rmSync(skillPath, { recursive: true, force: true });
                    removedFiles.push(skillPath);
                    cliLogger.print(`  ✓ Removed skill: ${skill}`);
                }
                catch (error) {
                    failedFiles.push(skillPath);
                    cliLogger.warn(`  ⚠ Failed to remove skill ${skill}: ${error.message}`);
                }
            }
            else {
                cliLogger.print(`  - Skill not found: ${skill}`);
            }
        }
        cliLogger.print('');
        // -------------------------------------------------------
        // Step 3: Clean CLAUDE.md
        // -------------------------------------------------------
        cliLogger.print('Step 3: Cleaning CLAUDE.md...');
        cliLogger.print('---------------------------------');
        await cleanClaudeMd(claudeDir, removedFiles, failedFiles);
        cliLogger.print('');
        // -------------------------------------------------------
        // Step 3.5: Clean Codex configuration
        // -------------------------------------------------------
        cliLogger.print('Step 3.5: Cleaning Codex configuration...');
        cliLogger.print('-------------------------------------------');
        await cleanCodexConfig(removedFiles, failedFiles);
        cliLogger.print('');
        // -------------------------------------------------------
        // Step 4: Remove feedback instructions file
        // -------------------------------------------------------
        cliLogger.print('Step 4: Removing feedback instructions...');
        cliLogger.print('-------------------------------------------');
        const feedbackPath = join(claudeDir, 'autoimprove-feedback-instructions.md');
        if (existsSync(feedbackPath)) {
            try {
                rmSync(feedbackPath, { force: true });
                removedFiles.push(feedbackPath);
                cliLogger.print('  ✓ Removed feedback instructions');
            }
            catch (error) {
                failedFiles.push(feedbackPath);
                cliLogger.warn(`  ⚠ Failed to remove feedback instructions: ${error.message}`);
            }
        }
        else {
            cliLogger.print('  - Feedback instructions not found');
        }
        cliLogger.print('');
        // -------------------------------------------------------
        // Step 5: Remove ONNX local ML (optional, requires confirmation)
        // -------------------------------------------------------
        cliLogger.print('Step 5: ONNX local ML cleanup...');
        cliLogger.print('-------------------------------------');
        const modelDir = join(storageDir, 'models');
        const mcpServerDir = join(getPackageRoot(), 'src/mcp-server-ts');
        const packageJsonPath = join(mcpServerDir, 'package.json');
        const hasOnnxDep = await checkOnnxDependency(packageJsonPath);
        const hasModelFiles = existsSync(modelDir) && readdirSync(modelDir).length > 0;
        if (hasOnnxDep || hasModelFiles) {
            cliLogger.print('ONNX local ML 组件检测到：');
            if (hasOnnxDep) {
                cliLogger.print('  • onnxruntime-node 依赖（MCP Server 的 package.json 中）');
            }
            if (hasModelFiles) {
                const modelFiles = readdirSync(modelDir);
                for (const f of modelFiles) {
                    const fullPath = join(modelDir, f);
                    const stats = statSync(fullPath);
                    const size = stats.isFile() ? ` (${(stats.size / 1024 / 1024).toFixed(1)}MB)` : '';
                    cliLogger.print(`  • ${f}${size}`);
                }
            }
            cliLogger.print('');
            const confirmed = await confirmPrompt('是否卸载 ONNX local ML 组件？（移除 onnxruntime-node 依赖和模型文件）[y/N] ');
            if (confirmed) {
                // Remove onnxruntime-node from package.json dependencies
                if (hasOnnxDep) {
                    try {
                        await removeOnnxDependency(packageJsonPath);
                        removedFiles.push(`${packageJsonPath} (removed onnxruntime-node dependency)`);
                        cliLogger.print('  ✓ Removed onnxruntime-node from package.json');
                    }
                    catch (error) {
                        failedFiles.push(`${packageJsonPath} (onnxruntime-node dependency)`);
                        cliLogger.warn(`  ⚠ Failed to remove onnxruntime-node dependency: ${error.message}`);
                    }
                }
                // Remove model files
                if (hasModelFiles) {
                    try {
                        const modelFiles = readdirSync(modelDir);
                        for (const f of modelFiles) {
                            const fullPath = join(modelDir, f);
                            rmSync(fullPath, { recursive: true, force: true });
                            removedFiles.push(fullPath);
                        }
                        cliLogger.print(`  ✓ Removed ${modelFiles.length} model file(s) from ${modelDir}`);
                    }
                    catch (error) {
                        failedFiles.push(modelDir);
                        cliLogger.warn(`  ⚠ Failed to remove model files: ${error.message}`);
                    }
                }
                // Remove node_modules/onnxruntime-node if present (orphaned dep)
                const onnxNodeModules = join(mcpServerDir, 'node_modules', 'onnxruntime-node');
                if (existsSync(onnxNodeModules)) {
                    try {
                        rmSync(onnxNodeModules, { recursive: true, force: true });
                        removedFiles.push(onnxNodeModules);
                        cliLogger.print('  ✓ Removed onnxruntime-node from node_modules');
                    }
                    catch (error) {
                        failedFiles.push(onnxNodeModules);
                        cliLogger.warn(`  ⚠ Failed to remove onnxruntime-node from node_modules: ${error.message}`);
                    }
                }
                cliLogger.print('');
                cliLogger.print('  ONNX local ML 已卸载。EmbeddingEncoder 将自动回退到');
                cliLogger.print('  零依赖的 char-ngram-tfidf 模式，不影响系统正常运行。');
                cliLogger.print('  如需重新安装，运行: bash scripts/install-onnx-models.sh');
            }
            else {
                cliLogger.print('  - 已跳过 ONNX 组件卸载');
            }
        }
        else {
            cliLogger.print('  - ONNX local ML 组件未安装，无需清理');
        }
        cliLogger.print('');
        // -------------------------------------------------------
        // Summary
        // -------------------------------------------------------
        cliLogger.print('==========================================');
        cliLogger.print('  Uninstall Summary');
        cliLogger.print('==========================================');
        cliLogger.print('');
        if (removedFiles.length > 0) {
            cliLogger.print('Removed files and directories:');
            cliLogger.print('---------------------------------------------');
            for (const file of removedFiles) {
                cliLogger.print(`  • ${file}`);
            }
            cliLogger.print('');
        }
        if (failedFiles.length > 0) {
            cliLogger.warn('Failed to remove (may need manual cleanup):');
            cliLogger.print('---------------------------------------------');
            for (const file of failedFiles) {
                cliLogger.warn(`  • ${file}`);
            }
            cliLogger.print('');
        }
        if (existsSync(storageDir)) {
            cliLogger.print('Preserved personal data:');
            cliLogger.print('---------------------------------------------');
            cliLogger.print(`  • ${storageDir}/ (rules, sessions, config, etc.)`);
            cliLogger.print('');
            // List preserved subdirectories for transparency
            const preservedItems = listDirectoryContents(storageDir);
            for (const item of preservedItems) {
                cliLogger.print(`    ${item}`);
            }
            cliLogger.print('');
        }
        cliLogger.print('==========================================');
        cliLogger.print('✅ Uninstall complete!');
        cliLogger.print('==========================================');
        cliLogger.print('');
        cliLogger.print('Your personal data (rules, sessions, learned patterns)');
        cliLogger.print('are preserved at:');
        cliLogger.print(`  ${storageDir}`);
        cliLogger.print('');
        cliLogger.print('To completely remove all data (including personal data):');
        cliLogger.print(`  rm -rf ${storageDir}`);
        cliLogger.print('');
    }
    catch (error) {
        cliLogger.error('');
        // 直接拼进 message：cliLogger.error 的第二参数按 Error 处理，传字符串会丢失信息
        cliLogger.error(`❌ Uninstall failed: ${error?.message ?? error}`);
        cliLogger.error('');
        process.exit(1);
    }
}
// -----------------------------------------------------------
// Helper: Remove MCP configuration at given scope
// -----------------------------------------------------------
async function removeMCPConfig(scope, removedFiles, failedFiles) {
    try {
        const checkResult = await runCommand('claude', ['mcp', 'get', 'autoimprove-core'], true);
        // claude CLI 输出 "Scope: User config ..."（大写），统一小写比较
        const scopeKey = `${scope} config`;
        const checkResultLower = checkResult.toLowerCase();
        if (checkResultLower.includes(scopeKey)) {
            await runCommand('claude', ['mcp', 'remove', 'autoimprove-core', '-s', scope], true);
            removedFiles.push(`claude mcp config (${scope}-scope): autoimprove-core`);
            cliLogger.print(`  ✓ Removed MCP configuration (${scope}-scope)`);
        }
        else {
            cliLogger.print(`  - No MCP configuration found (${scope}-scope)`);
        }
    }
    catch (error) {
        failedFiles.push(`claude mcp config (${scope}-scope): autoimprove-core`);
        cliLogger.warn(`  ⚠ Failed to remove MCP configuration (${scope}-scope): ${error.message}`);
    }
}
// -----------------------------------------------------------
// Helper: Clean AutoImprove references from CLAUDE.md
// -----------------------------------------------------------
async function cleanClaudeMd(claudeDir, removedFiles, failedFiles) {
    const globalClaudeMd = join(claudeDir, 'CLAUDE.md');
    if (!existsSync(globalClaudeMd)) {
        cliLogger.print('  - CLAUDE.md not found, nothing to clean');
        return;
    }
    try {
        let content = readFileSync(globalClaudeMd, 'utf-8');
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
                rmSync(globalClaudeMd, { force: true });
                removedFiles.push(globalClaudeMd);
                cliLogger.print('  ✓ Removed empty CLAUDE.md');
            }
            else {
                writeFileSync(globalClaudeMd, content + '\n');
                removedFiles.push(`${globalClaudeMd} (cleaned AutoImprove references)`);
                cliLogger.print('  ✓ Cleaned AutoImprove references from CLAUDE.md');
            }
        }
        else {
            cliLogger.print('  - No AutoImprove references found in CLAUDE.md');
        }
    }
    catch (error) {
        failedFiles.push(globalClaudeMd);
        cliLogger.warn(`  ⚠ Failed to clean CLAUDE.md: ${error.message}`);
    }
}
// -----------------------------------------------------------
// Helper: Clean Codex configuration (MCP settings, skill, agents)
// -----------------------------------------------------------
async function cleanCodexConfig(removedFiles, failedFiles) {
    const codexDir = join(homedir(), '.codex');
    const codexMcpSettings = join(codexDir, 'mcp_settings.json');
    const codexSkillDir = join(codexDir, 'skills', 'autoimprove');
    const codexSkillFile = join(codexSkillDir, 'SKILL.md');
    const codexAgentsDir = join(codexSkillDir, 'agents');
    const codexOpenaiYaml = join(codexAgentsDir, 'openai.yaml');
    // 1. Remove Codex skill directory
    if (existsSync(codexSkillDir)) {
        try {
            rmSync(codexSkillDir, { recursive: true, force: true });
            removedFiles.push(codexSkillDir);
            cliLogger.print('  ✓ Removed Codex skill: ~/.codex/skills/autoimprove/');
        }
        catch (error) {
            failedFiles.push(codexSkillDir);
            cliLogger.warn(`  ⚠ Failed to remove Codex skill: ${error.message}`);
        }
    }
    else {
        cliLogger.print('  - Codex skill not found');
    }
    // 2. Remove autoimprove-core from Codex MCP settings
    if (existsSync(codexMcpSettings)) {
        try {
            const settings = JSON.parse(readFileSync(codexMcpSettings, 'utf-8'));
            if (settings.mcpServers && settings.mcpServers['autoimprove-core']) {
                delete settings.mcpServers['autoimprove-core'];
                // If mcpServers is now empty, clean it up
                if (Object.keys(settings.mcpServers).length === 0) {
                    delete settings.mcpServers;
                }
                writeFileSync(codexMcpSettings, JSON.stringify(settings, null, 2) + '\n');
                removedFiles.push(`${codexMcpSettings} (removed autoimprove-core)`);
                cliLogger.print('  ✓ Removed autoimprove-core from Codex MCP settings');
            }
            else {
                cliLogger.print('  - No autoimprove-core in Codex MCP settings');
            }
        }
        catch (error) {
            failedFiles.push(codexMcpSettings);
            cliLogger.warn(`  ⚠ Failed to clean Codex MCP settings: ${error.message}`);
        }
    }
    else {
        cliLogger.print('  - Codex MCP settings not found');
    }
}
// -----------------------------------------------------------
// Helper: List contents of a directory (non-recursive)
// -----------------------------------------------------------
function listDirectoryContents(dir, prefix = '') {
    const items = [];
    if (!existsSync(dir)) {
        return items;
    }
    try {
        const entries = readdirSync(dir);
        for (const entry of entries) {
            const fullPath = join(dir, entry);
            const stats = statSync(fullPath);
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
        const proc = spawn(command, args, { stdio: 'pipe' });
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
        const rl = createInterface({
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
    if (!existsSync(packageJsonPath))
        return false;
    try {
        const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
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
    const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
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
    writeFileSync(packageJsonPath, JSON.stringify(content, null, 2) + '\n');
}
// -----------------------------------------------------------
// Helper: Get package root by looking for package.json
// -----------------------------------------------------------
function getPackageRoot() {
    // ESM 下没有 __dirname，用 import.meta.url 推导（与 summarize.ts 一致）
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
//# sourceMappingURL=uninstall.js.map