#!/usr/bin/env node
/**
 * Test script to verify template generation is enabled
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const configPath = join(homedir(), '.autoimprove', 'config.json');

console.log('🔍 Checking AutoImprove configuration...\n');

try {
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  console.log('📋 Config version:', config.version);
  console.log('\n🎯 Rule Generation Settings:');

  if (config.rule_generation) {
    console.log('  ✅ rule_generation section exists');
    console.log('  • use_template_generation:', config.rule_generation.use_template_generation);
    console.log('  • template_hot_reload:', config.rule_generation.template_hot_reload);

    if (config.rule_generation.use_template_generation === true) {
      console.log('\n✨ Template generation is ENABLED');
      console.log('   Next rule generation will use SOP compiler');
    } else {
      console.log('\n⚠️  Template generation is DISABLED');
      console.log('   Will use legacy HybridRuleGenerator');
    }
  } else {
    console.log('  ❌ rule_generation section missing');
    console.log('  Config needs to be upgraded to v1.1');
  }

  console.log('\n📂 Template Files:');
  const { readdirSync, existsSync } = await import('fs');
  const templateDir = join(process.cwd(), 'src', 'mcp-server-ts', 'src', 'core', 'rule-templates');

  if (existsSync(templateDir)) {
    const templates = readdirSync(templateDir).filter(f => f.endsWith('.md'));
    console.log(`  ✅ Found ${templates.length} templates:`);
    templates.forEach(t => console.log(`     - ${t}`));
  } else {
    console.log('  ❌ Template directory not found at:', templateDir);
  }

  console.log('\n🔧 To trigger a test:');
  console.log('  1. Create a test session with user corrections');
  console.log('  2. Run: /autoimprove-summarize');
  console.log('  3. Check logs: tail -f ~/.autoimprove/logs/*.jsonl | grep "template"');

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
