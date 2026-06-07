"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rules = rules;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
async function rules(options) {
    const storageDir = (0, path_1.join)((0, os_1.homedir)(), '.autoimprove');
    const rulesIndexPath = (0, path_1.join)(storageDir, 'rules/index.json');
    // Check if initialized
    if (!(0, fs_1.existsSync)(rulesIndexPath)) {
        console.error('❌ AutoImprove not initialized or no rules found');
        console.error('   Run: autoimprove setup');
        process.exit(1);
    }
    // Load rules
    const rulesIndex = JSON.parse((0, fs_1.readFileSync)(rulesIndexPath, 'utf-8'));
    let filteredRules = rulesIndex.rules;
    // Apply filters
    if (options.category) {
        filteredRules = filteredRules.filter((r) => r.category?.toLowerCase() === options.category?.toLowerCase());
    }
    if (options.minConfidence !== undefined) {
        filteredRules = filteredRules.filter((r) => r.confidence >= options.minConfidence);
    }
    if (options.priority) {
        filteredRules = filteredRules.filter((r) => r.priority?.toLowerCase() === options.priority?.toLowerCase());
    }
    // Display header
    console.log('=================================');
    console.log('  AutoImprove Rules');
    console.log('=================================');
    console.log('');
    if (filteredRules.length === 0) {
        console.log('No rules found matching the criteria.');
        console.log('');
        return;
    }
    // Group by priority
    const grouped = {
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
        if (rules.length === 0)
            continue;
        console.log(`${emoji} ${label}`);
        console.log('');
        for (const rule of rules) {
            console.log(`### [${rule.id}] ${rule.category || 'General'} [置信度: ${rule.confidence.toFixed(2)}]`);
            if (rule.keywords && rule.keywords.length > 0) {
                console.log(`**关键词**: ${rule.keywords.join(', ')}`);
            }
            console.log(`**规则**: ${rule.title}`);
            if (rule.description) {
                console.log(`**说明**: ${rule.description}`);
            }
            if (rule.applied_count || rule.ignored_count) {
                console.log(`**使用统计**: 应用 ${rule.applied_count || 0} 次, 忽略 ${rule.ignored_count || 0} 次`);
            }
            console.log('');
        }
    }
    // Summary
    console.log('---');
    console.log('');
    console.log(`Total: ${filteredRules.length} rules`);
    if (options.category || options.minConfidence || options.priority) {
        console.log('');
        console.log('Filters applied:');
        if (options.category)
            console.log(`  - Category: ${options.category}`);
        if (options.minConfidence)
            console.log(`  - Min confidence: ${options.minConfidence}`);
        if (options.priority)
            console.log(`  - Priority: ${options.priority}`);
    }
    console.log('');
    console.log('💡 Use /autoimprove-rules in Claude Code for detailed rule information');
    console.log('');
}
//# sourceMappingURL=rules.js.map