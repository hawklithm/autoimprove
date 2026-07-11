import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface RulesOptions {
  category?: string;
  minConfidence?: number;
  priority?: string;
}

export async function rules(options: RulesOptions) {
  const storageDir = join(homedir(), '.autoimprove');
  const rulesIndexPath = join(storageDir, 'rules/index.json');

  // Check if initialized
  if (!existsSync(rulesIndexPath)) {
    cliLogger.error('❌ AutoImprove not initialized or no rules found');
    cliLogger.error('   Run: autoimprove setup');
    process.exit(1);
  }

  // Load rules
  const rulesIndex = JSON.parse(readFileSync(rulesIndexPath, 'utf-8'));
  let filteredRules = rulesIndex.rules;

  // Apply filters
  if (options.category) {
    filteredRules = filteredRules.filter((r: any) =>
      r.category?.toLowerCase() === options.category?.toLowerCase()
    );
  }

  if (options.minConfidence !== undefined) {
    filteredRules = filteredRules.filter((r: any) =>
      r.confidence >= options.minConfidence!
    );
  }

  if (options.priority) {
    filteredRules = filteredRules.filter((r: any) =>
      r.priority?.toLowerCase() === options.priority?.toLowerCase()
    );
  }

  // Display header
  cliLogger.print('=================================');
  cliLogger.print('  AutoImprove Rules');
  cliLogger.print('=================================');
  cliLogger.print('');

  if (filteredRules.length === 0) {
    cliLogger.print('No rules found matching the criteria.');
    cliLogger.print('');
    return;
  }

  // Group by priority
  const grouped: Record<string, any[]> = {
    critical: [],
    high: [],
    medium: [],
    low: []
  };

  for (const rule of filteredRules) {
    const priority = rule.priority || 'low';
    if (!grouped[priority]) {
      grouped[priority] = [];
    }
    grouped[priority].push(rule);
  }

  // Display rules by priority
  const priorityConfig = [
    { key: 'critical', emoji: '🔴', label: 'Critical Security Rules' },
    { key: 'high', emoji: '🟠', label: 'High Priority Rules' },
    { key: 'medium', emoji: '🟡', label: 'Medium Priority Rules' },
    { key: 'low', emoji: '⚪', label: 'Preferences' }
  ];

  for (const { key, emoji, label } of priorityConfig) {
    const rules = grouped[key];
    if (rules.length === 0) continue;

    cliLogger.print(`${emoji} ${label}`);
    cliLogger.print('');

    for (const rule of rules) {
      cliLogger.print(`### [${rule.id}] ${rule.category || 'General'} [置信度: ${rule.confidence.toFixed(2)}]`);

      if (rule.keywords && rule.keywords.length > 0) {
        cliLogger.print(`**关键词**: ${rule.keywords.join(', ')}`);
      }

      cliLogger.print(`**规则**: ${rule.title}`);

      if (rule.description) {
        cliLogger.print(`**说明**: ${rule.description}`);
      }

      if (rule.applied_count || rule.ignored_count) {
        cliLogger.print(`**使用统计**: 应用 ${rule.applied_count || 0} 次, 忽略 ${rule.ignored_count || 0} 次`);
      }

      cliLogger.print('');
    }
  }

  // Summary
  cliLogger.print('---');
  cliLogger.print('');
  cliLogger.print(`Total: ${filteredRules.length} rules`);

  if (options.category || options.minConfidence || options.priority) {
    cliLogger.print('');
    cliLogger.print('Filters applied:');
    if (options.category) cliLogger.print(`  - Category: ${options.category}`);
    if (options.minConfidence) cliLogger.print(`  - Min confidence: ${options.minConfidence}`);
    if (options.priority) cliLogger.print(`  - Priority: ${options.priority}`);
  }

  cliLogger.print('');
  cliLogger.print('💡 Use /autoimprove-rules in Claude Code for detailed rule information');
  cliLogger.print('');
}
