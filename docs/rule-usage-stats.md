# 规则使用统计功能

## 📊 功能概述

AutoImprove 现在支持多维度的规则使用统计分析，帮助你了解哪些规则最常用、哪些规则需要优化、以及规则使用的趋势变化。

## 🎯 统计维度

### 1. 总体概览
- 总规则数
- 有使用记录的规则数量
- 总反馈数
- 平均每规则使用次数
- 统计时间范围

### 2. 按类别统计
- **Security**: 安全相关规则
- **Performance**: 性能优化规则
- **Best Practice**: 最佳实践规则
- **Style**: 代码风格规则
- **Preference**: 个人偏好规则

每个类别显示：
- 规则数量
- 使用/忽略/修正/禁用次数
- 平均置信度
- 平均用户评分

### 3. 按场景统计
- **技术栈 (Tech)**: TypeScript, React, Node.js 等
- **功能领域 (Functional)**: validation, error-handling, testing 等
- **业务领域 (Business)**: 特定业务场景

### 4. 按优先级统计
- Critical (关键)
- High (高)
- Medium (中)
- Low (低)

### 5. 时间趋势
- 每日使用趋势
- 每周使用趋势
- 可自定义时间范围

### 6. Top 规则
- 使用次数最多的规则
- 包含评分、忽略次数等详细信息

### 7. 问题规则
- 高忽略率规则（>50%）
- 高修正率规则（>30%）
- 高禁用率规则（>10%）
- 帮助识别需要优化的规则

## 🚀 使用方式

### 方式 1: MCP 工具（推荐）

在 Claude Code 中直接调用 MCP 工具：

```typescript
// 获取所有统计信息（JSON 格式）
mcp__autoimprove-core__get_rule_usage_stats({
  output_format: "json"
})

// 获取 Markdown 格式报告
mcp__autoimprove-core__get_rule_usage_stats({
  output_format: "markdown"
})

// 获取最近 30 天的统计
mcp__autoimprove-core__get_rule_usage_stats({
  start_date: "2026-05-01",
  end_date: "2026-06-01",
  output_format: "markdown"
})

// 筛选特定类别
mcp__autoimprove-core__get_rule_usage_stats({
  categories: ["Security", "Performance"],
  top_n: 20,
  output_format: "markdown"
})

// 快速摘要
mcp__autoimprove-core__get_rule_usage_stats({
  output_format: "summary"
})
```

**参数说明：**
- `output_format`: 输出格式 (`json` | `markdown` | `summary`)
- `start_date`: 开始日期 (ISO 格式: YYYY-MM-DD)
- `end_date`: 结束日期 (ISO 格式: YYYY-MM-DD)
- `categories`: 类别筛选（数组）
- `top_n`: Top 规则数量（默认 10）
- `min_feedbacks`: 问题规则的最小反馈数（默认 5）

### 方式 2: 独立脚本

使用命令行脚本直接生成统计报告：

```bash
# 基本用法（生成 Markdown 报告）
cd /Users/adazhao/workspace/autoimprove
node scripts/rule-usage-stats.ts

# 保存到文件
node scripts/rule-usage-stats.ts --output=report.md

# 最近 30 天的统计
node scripts/rule-usage-stats.ts --last=30days

# 特定时间范围
node scripts/rule-usage-stats.ts --start=2026-01-01 --end=2026-06-01

# 筛选类别
node scripts/rule-usage-stats.ts --category=Security --category=Performance

# 显示 Top 20 规则
node scripts/rule-usage-stats.ts --top=20

# JSON 格式输出
node scripts/rule-usage-stats.ts --format=json --output=stats.json

# 快速摘要
node scripts/rule-usage-stats.ts --format=summary

# 查看帮助
node scripts/rule-usage-stats.ts --help
```

**脚本参数：**
- `--format <type>`: 输出格式 (json, markdown, summary)
- `--output <file>`: 输出文件路径
- `--start <date>`: 开始日期 (YYYY-MM-DD)
- `--end <date>`: 结束日期 (YYYY-MM-DD)
- `--last <period>`: 时间段 (7days, 30days, 90days, 1year)
- `--category <cat>`: 类别筛选（可多次指定）
- `--top <n>`: Top 规则数量
- `--min-feedbacks <n>`: 最小反馈数
- `--help, -h`: 显示帮助信息

## 📄 报告示例

### Markdown 格式

```markdown
# 📊 AutoImprove 规则使用统计报告

**生成时间**: 2026-06-06T10:30:00.000Z
**统计周期**: 2026-01-01 至 2026-06-06

## 📈 总体概览

- 总规则数: 45
- 有使用记录的规则: 32 (71.1%)
- 总反馈数: 1,248
- 平均每规则使用次数: 39.0

## 🏷️ 按类别统计

| 类别 | 规则数 | 使用次数 | 忽略次数 | 修正次数 | 平均置信度 | 平均评分 |
|------|--------|----------|----------|----------|------------|----------|
| Security | 8 | 342 | 12 | 5 | 0.88 | 4.6 |
| Performance | 5 | 215 | 45 | 8 | 0.76 | 4.2 |
| Best Practice | 12 | 456 | 89 | 12 | 0.82 | 4.5 |
| Style | 7 | 123 | 156 | 3 | 0.65 | 3.8 |
| Preference | 13 | 112 | 34 | 2 | 0.79 | 4.4 |

## ⚡ 按优先级统计

| 优先级 | 规则数 | 使用次数 | 忽略次数 | 平均置信度 |
|--------|--------|----------|----------|------------|
| critical | 3 | 156 | 8 | 0.92 |
| high | 12 | 489 | 67 | 0.85 |
| medium | 20 | 512 | 189 | 0.78 |
| low | 10 | 91 | 72 | 0.68 |

## 🎯 按场景统计

### 技术栈（Tech）
- **TypeScript**: 234次使用, 45次忽略
- **React**: 189次使用, 32次忽略
- **Node.js**: 145次使用, 28次忽略

### 功能领域（Functional）
- **validation**: 312次使用, 23次忽略
- **error-handling**: 289次使用, 34次忽略
- **testing**: 176次使用, 45次忽略

## ⭐ Top 10 最常使用的规则

1. **RULE-010** (Security/critical) - 89次 ⭐️4.6
2. **RULE-008** (Preference/high) - 67次 ⭐️4.8
3. **RULE-009** (Preference/high) - 54次 ⭐️4.2 (忽略12次)

## ⚠️ 需要关注的规则

| 规则ID | 类别 | 总反馈 | 忽略率 | 修正率 | 禁用率 |
|--------|------|--------|--------|--------|--------|
| RULE-015 | Style | 45 | 68.0% | 15.0% | 2.0% |
| RULE-023 | Performance | 32 | 56.0% | 28.0% | 0.0% |

## 📅 使用趋势（按周）

\```
周次         使用  忽略  修正
2026-W18      145    23     5
2026-W19      178    34     8
2026-W20      156    28     6
2026-W21      189    31     7
\```
```

### Summary 格式

```
📊 规则使用统计概要

总规则: 45 | 有使用记录: 32 | 总反馈: 1,248

使用最多的类别: Best Practice (456次)
使用最多的规则: RULE-010 (89次)
需要关注的规则: 2个
```

### JSON 格式

完整的 JSON 数据结构，包含所有维度的详细统计信息。适合进一步处理和分析。

## 💡 使用建议

### 1. 定期查看统计
建议每周或每月查看一次统计报告，了解规则使用情况：

```bash
# 生成月度报告
node scripts/rule-usage-stats.ts --last=30days --output=reports/monthly-$(date +%Y-%m).md
```

### 2. 优化问题规则
关注"需要关注的规则"部分：
- **高忽略率**: 规则可能不适用或描述不清晰
- **高修正率**: 规则可能不准确，需要调整
- **高禁用率**: 规则可能存在问题，考虑移除

### 3. 分析类别趋势
观察哪些类别的规则最常用，调整规则生成策略：

```bash
# 查看 Security 类别的详细统计
node scripts/rule-usage-stats.ts --category=Security --top=20
```

### 4. 导出数据分析
使用 JSON 格式导出数据，进行更深入的分析：

```bash
node scripts/rule-usage-stats.ts --format=json --output=stats.json
# 然后使用其他工具（如 Python, jq）进行分析
```

### 5. 集成到 CI/CD
可以在 CI/CD 流程中自动生成统计报告，追踪规则使用趋势。

## 🔧 技术实现

### 数据源
- **反馈历史**: `~/.autoimprove/feedback_history.jsonl`
- **规则索引**: `~/.autoimprove/rules/index.json`
- **规则内容**: `~/.autoimprove/rules/content/*.md`

### 核心类
- `RuleUsageStatsAnalyzer`: 统计分析引擎
  - 多维度聚合
  - 时间序列分析
  - 报告生成

### MCP 工具
- `get_rule_usage_stats`: 提供统计查询接口
  - 支持时间范围筛选
  - 支持类别筛选
  - 支持多种输出格式

## 📚 相关文档

- [AutoImprove README](../README.md)
- [规则匹配机制](./rule-matching.md)
- [反馈系统](./feedback-system.md)

## 🎉 总结

规则使用统计功能帮助你：
1. ✅ 了解规则的实际使用情况
2. ✅ 识别需要优化的问题规则
3. ✅ 追踪规则使用趋势
4. ✅ 做出数据驱动的决策

立即开始使用，让数据指导你优化 AutoImprove 规则库！
