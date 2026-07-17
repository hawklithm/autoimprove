import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface SetupOptions {
  force?: boolean;
}

export async function setup(options: SetupOptions) {
  cliLogger.print('=================================');
  cliLogger.print('  AutoImprove Setup');
  cliLogger.print('=================================');
  cliLogger.print('');

  try {
    // Step 1: Check prerequisites
    cliLogger.print('Step 1: Checking prerequisites...');
    cliLogger.print('-----------------------------------');

    if (!await hasCommand('node')) {
      throw new Error('Node.js is not installed. Please install Node.js 18+ first.');
    }

    const nodeVersion = await getNodeVersion();
    if (nodeVersion < 18) {
      throw new Error(`Node.js 18+ is required. Current version: ${nodeVersion}`);
    }
    cliLogger.print(`✓ Node.js ${nodeVersion} detected`);

    if (!await hasCommand('claude')) {
      throw new Error('Claude Code CLI not found. Please install from: https://claude.ai/download');
    }
    cliLogger.print('✓ Claude Code CLI detected');
    cliLogger.print('');

    // Step 2: Get installation paths
    cliLogger.print('Step 2: Resolving paths...');
    cliLogger.print('-----------------------------------');

    const packageRoot = getPackageRoot();
    const mcpServerPath = join(packageRoot, 'src/mcp-server-ts/dist/index.js');
    const templatesDir = join(packageRoot, 'templates');
    const storageDir = join(homedir(), '.autoimprove');
    const claudeDir = join(homedir(), '.claude');

    cliLogger.print(`Package root: ${packageRoot}`);
    cliLogger.print(`Storage: ${storageDir}`);
    cliLogger.print('');

    // Step 3: Build MCP Server if needed
    cliLogger.print('Step 3: Building MCP Server...');
    cliLogger.print('-----------------------------------');

    if (!existsSync(mcpServerPath)) {
      cliLogger.print('MCP Server not built, building now...');
      await buildMCPServer(packageRoot);
    } else {
      cliLogger.print('✓ MCP Server already built');
    }
    cliLogger.print('');

    // Step 4: Initialize storage
    cliLogger.print('Step 4: Initializing storage...');
    cliLogger.print('-----------------------------------');

    await initializeStorage(storageDir, options.force);
    cliLogger.print('');

    // Step 5: Configure MCP Server
    cliLogger.print('Step 5: Configuring MCP Server...');
    cliLogger.print('-----------------------------------');

    await configureMCPServer(mcpServerPath, options.force);
    cliLogger.print('');

    // Step 6: Install Skills
    cliLogger.print('Step 6: Installing Skills...');
    cliLogger.print('-----------------------------------');

    await installSkills(packageRoot, claudeDir);
    cliLogger.print('');

    // Step 7: Configure Claude.md
    cliLogger.print('Step 7: Configuring Claude Code...');
    cliLogger.print('-----------------------------------');

    await configureClaudeMd(storageDir, claudeDir, templatesDir);
    cliLogger.print('');

    // Done
    cliLogger.print('=================================');
    cliLogger.print('✅ Setup Complete!');
    cliLogger.print('=================================');
    cliLogger.print('');
    cliLogger.print('Next steps:');
    cliLogger.print('  1. Run: autoimprove status');
    cliLogger.print('  2. Start using Claude Code - rules will load automatically');
    cliLogger.print('  3. After a coding session, run: autoimprove summarize');
    cliLogger.print('');

  } catch (error: any) {
    cliLogger.error('');
    cliLogger.error('❌ Setup failed:', error.message);
    cliLogger.error('');
    process.exit(1);
  }
}

// Helper functions

async function hasCommand(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('command', ['-v', command], { shell: true });
    proc.on('close', (code) => resolve(code === 0));
  });
}

async function getNodeVersion(): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['--version']);
    let output = '';
    proc.stdout.on('data', (data) => output += data);
    proc.on('close', (code) => {
      if (code === 0) {
        const version = parseInt(output.trim().replace('v', '').split('.')[0]);
        resolve(version);
      } else {
        reject(new Error('Failed to get Node version'));
      }
    });
  });
}

function getPackageRoot(): string {
  // When installed globally, __dirname will be in lib/commands/
  // Need to go up to package root
  let current = __dirname;
  while (current !== '/') {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    current = join(current, '..');
  }
  throw new Error('Could not find package root');
}

async function buildMCPServer(packageRoot: string): Promise<void> {
  const mcpServerDir = join(packageRoot, 'src/mcp-server-ts');

  return new Promise((resolve, reject) => {
    cliLogger.print('  Installing dependencies...');
    const install = spawn('npm', ['install'], { cwd: mcpServerDir, stdio: 'inherit' });

    install.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Failed to install MCP Server dependencies'));
        return;
      }

      cliLogger.print('  Building...');
      const build = spawn('npm', ['run', 'build'], { cwd: mcpServerDir, stdio: 'inherit' });

      build.on('close', (buildCode) => {
        if (buildCode !== 0) {
          reject(new Error('Failed to build MCP Server'));
        } else {
          cliLogger.print('✓ MCP Server built successfully');
          resolve();
        }
      });
    });
  });
}

async function initializeStorage(storageDir: string, force?: boolean): Promise<void> {
  if (existsSync(storageDir) && !force) {
    cliLogger.print('✓ Storage already initialized');
    return;
  }

  // Create directories
  mkdirSync(join(storageDir, 'rules/content'), { recursive: true });
  mkdirSync(join(storageDir, 'sessions'), { recursive: true });
  mkdirSync(join(storageDir, 'cache'), { recursive: true });
  mkdirSync(join(storageDir, 'logs'), { recursive: true });

  // Create config.json
  const config = {
    version: '1.0',
    confidence_thresholds: {
      repeated_correction: 0.45,
      anti_pattern: 0.45,
      preference: 0.3,
      performance: 0.4,
      security: 0.3
    },
    confidence_weights: {
      frequency: 0.3,
      time_span: 0.1,
      behavior: 0.4,
      validation: 0.2
    },
    rule_matching: {
      max_results: 10,
      min_confidence: 0.3
    },
    business_domain_mappings: {}
  };
  writeFileSync(join(storageDir, 'config.json'), JSON.stringify(config, null, 2));

  // Create rules/index.json
  const rulesIndex = {
    version: '1.0',
    rules: []
  };
  writeFileSync(join(storageDir, 'rules/index.json'), JSON.stringify(rulesIndex, null, 2));

  // Create initial claude-index.md
  const claudeIndex = `# AutoImprove Learned Rules

> These rules are automatically learned from your coding habits and will match based on your current work context.

---

💡 **Dynamic Matching**: Claude will automatically apply relevant rules based on your current code context.
📊 **Full Rule Library**: Run \`autoimprove rules\` to view all rules.
`;
  writeFileSync(join(storageDir, 'rules/claude-index.md'), claudeIndex);

  cliLogger.print('✓ Storage initialized at:', storageDir);
}

async function configureMCPServer(mcpServerPath: string, force?: boolean): Promise<void> {
  // Check if already configured
  const checkResult = await runCommand('claude', ['mcp', 'get', 'autoimprove-core']);

  if (checkResult.includes('user config') && !force) {
    cliLogger.print('✓ MCP Server already configured (user-level)');
    return;
  }

  // Remove existing configurations
  if (checkResult.includes('user config') || checkResult.includes('local config')) {
    cliLogger.print('Removing old configuration...');
    await runCommand('claude', ['mcp', 'remove', 'autoimprove-core', '-s', 'user'], true);
    await runCommand('claude', ['mcp', 'remove', 'autoimprove-core', '-s', 'local'], true);
  }

  // Add MCP server
  cliLogger.print('Adding MCP Server (user-level)...');
  await runCommand('claude', ['mcp', 'add', 'autoimprove-core', '-s', 'user', '--', 'node', mcpServerPath]);

  cliLogger.print('✓ MCP Server configured successfully');
  cliLogger.print('✓ Server will be available in all projects');
}

async function installSkills(packageRoot: string, claudeDir: string): Promise<void> {
  const skillsSourceDir = join(packageRoot, 'src/skills-ts/src');
  const skillsTargetDir = join(claudeDir, 'skills');

  mkdirSync(skillsTargetDir, { recursive: true });

  const skills = [
    'autoimprove-status',
    'autoimprove-rules',
    'autoimprove-lessons',
    'autoimprove-summarize',
    'autoimprove-check'
  ];

  for (const skill of skills) {
    const sourceDir = join(skillsSourceDir, skill);
    const targetDir = join(skillsTargetDir, skill);

    if (existsSync(sourceDir)) {
      // Copy skill directory
      mkdirSync(targetDir, { recursive: true });

      const files = ['SKILL.md', 'skill.ts', 'manifest.json'];
      for (const file of files) {
        const sourcePath = join(sourceDir, file);
        if (existsSync(sourcePath)) {
          copyFileSync(sourcePath, join(targetDir, file));
        }
      }

      cliLogger.print(`  ✓ ${skill}`);
    }
  }

  cliLogger.print('✓ Skills installed successfully');
}

async function configureClaudeMd(storageDir: string, claudeDir: string, templatesDir: string): Promise<void> {
  const globalClaudeMd = join(claudeDir, 'CLAUDE.md');
  const rulesIndexPath = join(storageDir, 'rules/claude-index.md');
  const feedbackInstructionsPath = join(claudeDir, 'autoimprove-feedback-instructions.md');

  // Create CLAUDE.md if it doesn't exist
  if (!existsSync(globalClaudeMd)) {
    writeFileSync(globalClaudeMd, '');
  }

  let content = readFileSync(globalClaudeMd, 'utf-8');

  // Keep the short marker-delimited guidance in sync with setup_claude.sh.
  const guidanceTemplate = join(templatesDir, 'claude-guidance-template.md');
  if (existsSync(guidanceTemplate)) {
    const guidance = readFileSync(guidanceTemplate, 'utf-8').trim();
    const guidancePattern = /<!-- AUTOIMPROVE_START -->[\s\S]*?<!-- AUTOIMPROVE_END -->/;
    content = guidancePattern.test(content)
      ? content.replace(guidancePattern, guidance)
      : `${content.trimEnd()}\n\n${guidance}\n`;
    cliLogger.print('  ✓ Updated concise AutoImprove guidance');
  }

  // Add rules reference if not present
  if (!content.includes('autoimprove/rules/claude-index.md')) {
    content += '\n## AutoImprove Learned Rules\n\n';
    content += `@~/.autoimprove/rules/claude-index.md\n\n`;
    cliLogger.print('  ✓ Added rules reference to CLAUDE.md');
  } else {
    cliLogger.print('  ✓ Rules reference already exists');
  }

  // Copy feedback instructions template
  const feedbackTemplate = join(templatesDir, 'claude-feedback-instructions.md');
  if (existsSync(feedbackTemplate)) {
    copyFileSync(feedbackTemplate, feedbackInstructionsPath);

    // Add feedback reference if not present
    if (!content.includes('autoimprove-feedback-instructions.md')) {
      content += '## AutoImprove Rule Feedback\n\n';
      content += `@~/.claude/autoimprove-feedback-instructions.md\n\n`;
      cliLogger.print('  ✓ Added feedback instructions reference');
    } else {
      cliLogger.print('  ✓ Feedback reference already exists');
    }
  }

  writeFileSync(globalClaudeMd, content);
  cliLogger.print('✓ Claude Code configuration updated');
}

async function runCommand(command: string, args: string[], ignoreError = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'pipe' });
    let output = '';
    let error = '';

    proc.stdout.on('data', (data) => output += data);
    proc.stderr.on('data', (data) => error += data);

    proc.on('close', (code) => {
      if (code !== 0 && !ignoreError) {
        reject(new Error(error || output));
      } else {
        resolve(output);
      }
    });
  });
}
