#!/usr/bin/env node
/**
 * Config Migration Script
 *
 * Migrates old config.json to include new rule_generation settings.
 * Safe to run multiple times (idempotent).
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_PATH = path.join(os.homedir(), '.autoimprove', 'config.json');
const BACKUP_PATH = path.join(os.homedir(), '.autoimprove', 'config.json.backup');

function migrateConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log('❌ Config file not found at:', CONFIG_PATH);
    console.log('   Run AutoImprove setup first.');
    process.exit(1);
  }

  // Backup existing config
  fs.copyFileSync(CONFIG_PATH, BACKUP_PATH);
  console.log('✅ Backed up config to:', BACKUP_PATH);

  // Load existing config
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  console.log('\n📋 Current config version:', config.version);

  // Check if already migrated
  if (config.rule_generation) {
    console.log('✅ Config already has rule_generation settings:');
    console.log('   - use_template_generation:', config.rule_generation.use_template_generation);
    console.log('   - template_hot_reload:', config.rule_generation.template_hot_reload);
    console.log('\n✨ No migration needed.');
    return;
  }

  // Add new rule_generation settings
  config.rule_generation = {
    use_template_generation: false, // Default to legacy for safety
    template_hot_reload: false      // Disabled by default
  };

  // Update version to indicate migration
  const oldVersion = config.version;
  config.version = "1.1"; // Increment version

  // Write updated config
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('\n✅ Config migrated successfully!');
  console.log('   Version:', oldVersion, '→', config.version);
  console.log('\n📝 Added settings:');
  console.log('   - rule_generation.use_template_generation: false (legacy mode)');
  console.log('   - rule_generation.template_hot_reload: false (production mode)');
  console.log('\n💡 To enable template-based generation:');
  console.log('   1. Edit ~/.autoimprove/config.json');
  console.log('   2. Set "use_template_generation": true');
  console.log('   3. Restart MCP server: claude mcp restart autoimprove-core');
}

try {
  migrateConfig();
} catch (error) {
  console.error('\n❌ Migration failed:', error.message);
  console.error('\n🔄 Restoring backup...');
  if (fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(BACKUP_PATH, CONFIG_PATH);
    console.log('✅ Config restored from backup');
  }
  process.exit(1);
}
