import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface SetupOptions {
  force?: boolean;
}

export async function setup(options: SetupOptions) {
  console.log('=================================');
  console.log('  AutoImprove Setup');
  console.log('=================================');
  console.log('');

  try {
    // Step 1: Check prerequisites
    console.log('Step 1: Checking prerequisites...');
    console.log('-----------------------------------');

    if (!await hasCommand('node')) {
      throw new Error('Node.js is not installed. Please install Node.js 18+ first.');
    }

    const nodeVersion = await getNodeVersion();
    if (nodeVersion < 18) {
      throw new Error(`Node.js 18+ is required. Current version: ${nodeVersion}`);
    }
    console.log(`✓ Node.js ${nodeVersion} detected`);

    if (!await hasCommand('claude')) {
      throw new Error('Claude Code CLI not found. Please install from: https://claude.ai/download');
    }
    console.log('✓ Claude Code CLI detected');
    console.log('');

    // Step 2: Get installation paths
    console.log('Step 2: Resolving paths...');
    console.log('-----------------------------------');

    const packageRoot = getPackageRoot();
    const mcpServerPath = join(packageRoot, 'src/mcp-server-ts/dist/index.js');
    const templatesDir = join(packageRoot, 'templates');
    const storageDir = join(homedir(), '.autoimprove');
    const claudeDir = join(homedir(), '.claude');

    console.log(`Package root: ${packageRoot}`);
    console.log(`Storage: ${storageDir}`);
    console.log('');

    // Step 3: Build MCP Server if needed
    console.log('Step 3: Building MCP Server...');
    console.log('-----------------------------------');

    if (!existsSync(mcpServerPath)) {
      console.log('MCP Server not built, building now...');
      await buildMCPServer(packageRoot);
    } else {
      console.log('✓ MCP Server already built');
    }
    console.log('');

    // Step 4: Initialize storage
    console.log('Step 4: Initializing storage...');
    console.log('-----------------------------------');

    await initializeStorage(storageDir, options.force);
    console.log('');

    // Step 5: Configure MCP Server
    console.log('Step 5: Configuring MCP Server...');
    console.log('-----------------------------------');

    await configureMCPServer(mcpServerPath, options.force);
    console.log('');

    // Step 6: Install Skills
    console.log('Step 6: Installing Skills...');
    console.log('-----------------------------------');

    await installSkills(packageRoot, claudeDir);
    console.log('');

    // Step 7: Configure Claude.md
    console.log('Step 7: Configuring Claude Code...');
    console.log('-----------------------------------');

    await configureClaudeMd(storageDir, claudeDir, templatesDir);
    console.log('');

    // Done
    console.log('=================================');
    console.log('✅ Setup Complete!');
    console.log('=================================');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run: autoimprove status');
    console.log('  2. Start using Claude Code - rules will load automatically');
    console.log('  3. After a coding session, run: autoimprove summarize');
    console.log('');

  } catch (error: any) {
    console.error('');
    console.error('❌ Setup failed:', error.message);
    console.error('');
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
    console.log('  Installing dependencies...');
    const install = spawn('npm', ['install'], { cwd: mcpServerDir, stdio: 'inherit' });

    install.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Failed to install MCP Server dependencies'));
        return;
      }

      console.log('  Building...');
      const build = spawn('npm', ['run', 'build'], { cwd: mcpServerDir, stdio: 'inherit' });

      build.on('close', (buildCode) => {
        if (buildCode !== 0) {
          reject(new Error('Failed to build MCP Server'));
        } else {
          console.log('✓ MCP Server built successfully');
          resolve();
        }
      });
    });
  });
}

async function initializeStorage(storageDir: string, force?: boolean): Promise<void> {
  if (existsSync(storageDir) && !force) {
    console.log('✓ Storage already initialized');
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

  console.log('✓ Storage initialized at:', storageDir);
}

async function configureMCPServer(mcpServerPath: string, force?: boolean): Promise<void> {
  // Check if already configured
  const checkResult = await runCommand('claude', ['mcp', 'get', 'autoimprove-core']);

  if (checkResult.includes('user config') && !force) {
    console.log('✓ MCP Server already configured (user-level)');
    return;
  }

  // Remove existing configurations
  if (checkResult.includes('user config') || checkResult.includes('local config')) {
    console.log('Removing old configuration...');
    await runCommand('claude', ['mcp', 'remove', 'autoimprove-core', '-s', 'user'], true);
    await runCommand('claude', ['mcp', 'remove', 'autoimprove-core', '-s', 'local'], true);
  }

  // Add MCP server
  console.log('Adding MCP Server (user-level)...');
  await runCommand('claude', ['mcp', 'add', 'autoimprove-core', '-s', 'user', '--', 'node', mcpServerPath]);

  console.log('✓ MCP Server configured successfully');
  console.log('✓ Server will be available in all projects');
}

async function installSkills(packageRoot: string, claudeDir: string): Promise<void> {
  const skillsSourceDir = join(packageRoot, 'src/skills-ts/src');
  const skillsTargetDir = join(claudeDir, 'skills');

  mkdirSync(skillsTargetDir, { recursive: true });

  const skills = [
    'autoimprove-status',
    'autoimprove-rules',
    'autoimprove-lessons',
    'autoimprove-summarize'
  ];

  for (const skill of skills) {
    const sourceDir = join(skillsSourceDir, skill);
    const targetDir = join(skillsTargetDir, skill);

    if (existsSync(sourceDir)) {
      // Copy skill directory
      mkdirSync(targetDir, { recursive: true });

      const files = ['SKILL.md', 'skill.ts'];
      for (const file of files) {
        const sourcePath = join(sourceDir, file);
        if (existsSync(sourcePath)) {
          copyFileSync(sourcePath, join(targetDir, file));
        }
      }

      console.log(`  ✓ ${skill}`);
    }
  }

  console.log('✓ Skills installed successfully');
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

  // Add rules reference if not present
  if (!content.includes('autoimprove/rules/claude-index.md')) {
    content += '\n## AutoImprove Learned Rules\n\n';
    content += `@~/.autoimprove/rules/claude-index.md\n\n`;
    console.log('  ✓ Added rules reference to CLAUDE.md');
  } else {
    console.log('  ✓ Rules reference already exists');
  }

  // Copy feedback instructions template
  const feedbackTemplate = join(templatesDir, 'claude-feedback-instructions.md');
  if (existsSync(feedbackTemplate)) {
    copyFileSync(feedbackTemplate, feedbackInstructionsPath);

    // Add feedback reference if not present
    if (!content.includes('autoimprove-feedback-instructions.md')) {
      content += '## AutoImprove Rule Feedback\n\n';
      content += `@~/.claude/autoimprove-feedback-instructions.md\n\n`;
      console.log('  ✓ Added feedback instructions reference');
    } else {
      console.log('  ✓ Feedback reference already exists');
    }
  }

  writeFileSync(globalClaudeMd, content);
  console.log('✓ Claude Code configuration updated');
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
