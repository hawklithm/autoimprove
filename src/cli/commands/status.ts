import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';

export async function status() {
  console.log('=================================');
  console.log('  AutoImprove Status');
  console.log('=================================');
  console.log('');

  const storageDir = join(homedir(), '.autoimprove');
  const claudeDir = join(homedir(), '.claude');

  // Check storage
  console.log('Storage:');
  console.log('-----------------------------------');
  if (existsSync(storageDir)) {
    console.log(`✓ Storage directory: ${storageDir}`);

    const rulesIndexPath = join(storageDir, 'rules/index.json');
    if (existsSync(rulesIndexPath)) {
      const rulesIndex = JSON.parse(readFileSync(rulesIndexPath, 'utf-8'));
      console.log(`✓ Rules: ${rulesIndex.rules.length} total`);

      // Count by priority
      const priorities = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const rule of rulesIndex.rules) {
        const priority = rule.priority || 'low';
        priorities[priority as keyof typeof priorities]++;
      }
      console.log(`  - 🔴 Critical: ${priorities.critical}`);
      console.log(`  - 🟠 High: ${priorities.high}`);
      console.log(`  - 🟡 Medium: ${priorities.medium}`);
      console.log(`  - ⚪ Low: ${priorities.low}`);
    } else {
      console.log('⚠ Rules index not found');
    }

    const sessionsDir = join(storageDir, 'sessions');
    if (existsSync(sessionsDir)) {
      const sessions = require('fs').readdirSync(sessionsDir).filter((f: string) => f.endsWith('.json'));
      console.log(`✓ Sessions: ${sessions.length} tracked`);
    }
  } else {
    console.log('❌ Storage not initialized');
    console.log('   Run: autoimprove setup');
  }
  console.log('');

  // Check MCP Server
  console.log('MCP Server:');
  console.log('-----------------------------------');
  try {
    const mcpStatus = await runCommand('claude', ['mcp', 'get', 'autoimprove-core']);
    if (mcpStatus.includes('user config')) {
      console.log('✓ Registered (user-level)');

      // Extract path from status
      const pathMatch = mcpStatus.match(/command:\s*node\s+(.+)/);
      if (pathMatch) {
        const serverPath = pathMatch[1];
        console.log(`  Path: ${serverPath}`);

        if (existsSync(serverPath)) {
          console.log('  ✓ Server file exists');
        } else {
          console.log('  ⚠ Server file not found');
        }
      }
    } else {
      console.log('❌ Not registered');
      console.log('   Run: autoimprove setup');
    }
  } catch (error: any) {
    console.log('❌ Failed to check MCP status');
    console.log(`   ${error.message}`);
  }
  console.log('');

  // Check Skills
  console.log('Skills:');
  console.log('-----------------------------------');
  const skillsDir = join(claudeDir, 'skills');
  const expectedSkills = [
    'autoimprove-status',
    'autoimprove-rules',
    'autoimprove-lessons',
    'autoimprove-summarize'
  ];

  let installedCount = 0;
  for (const skill of expectedSkills) {
    const skillPath = join(skillsDir, skill, 'SKILL.md');
    if (existsSync(skillPath)) {
      console.log(`✓ /${skill.replace('autoimprove-', '')}`);
      installedCount++;
    } else {
      console.log(`❌ /${skill.replace('autoimprove-', '')}`);
    }
  }

  if (installedCount === 0) {
    console.log('⚠ No skills installed');
    console.log('   Run: autoimprove setup');
  }
  console.log('');

  // Check Claude.md
  console.log('Configuration:');
  console.log('-----------------------------------');
  const globalClaudeMd = join(claudeDir, 'CLAUDE.md');
  if (existsSync(globalClaudeMd)) {
    const content = readFileSync(globalClaudeMd, 'utf-8');

    if (content.includes('autoimprove/rules/claude-index.md')) {
      console.log('✓ Rules reference configured in CLAUDE.md');
    } else {
      console.log('⚠ Rules reference missing from CLAUDE.md');
      console.log('   Run: autoimprove setup --force');
    }

    if (content.includes('autoimprove-feedback-instructions.md')) {
      console.log('✓ Feedback instructions configured');
    } else {
      console.log('⚠ Feedback instructions missing');
      console.log('   Run: autoimprove setup --force');
    }
  } else {
    console.log('⚠ CLAUDE.md not found');
    console.log('   Will be created on setup');
  }
  console.log('');

  // Overall status
  const hasStorage = existsSync(storageDir);
  const hasMCP = await checkMCPRegistered();
  const hasSkills = installedCount > 0;

  if (hasStorage && hasMCP && hasSkills) {
    console.log('=================================');
    console.log('✅ System is operational');
    console.log('=================================');
  } else {
    console.log('=================================');
    console.log('⚠ System needs setup');
    console.log('=================================');
    console.log('');
    console.log('Run: autoimprove setup');
  }
  console.log('');
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'pipe' });
    let output = '';
    let error = '';

    proc.stdout.on('data', (data) => output += data);
    proc.stderr.on('data', (data) => error += data);

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(error || output));
      } else {
        resolve(output);
      }
    });
  });
}

async function checkMCPRegistered(): Promise<boolean> {
  try {
    const result = await runCommand('claude', ['mcp', 'get', 'autoimprove-core']);
    return result.includes('user config');
  } catch {
    return false;
  }
}
