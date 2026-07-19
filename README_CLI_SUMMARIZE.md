# AutoImprove - Command-Line Summarize Tool

✅ **已创建！** 现在你可以在命令行直接运行 summarize 功能，无需在 Claude Code 交互式会话中操作。

## 快速开始

```bash
# 方式 1: 使用 shell 脚本（推荐）
./summarize.sh

# 方式 2: 使用 npm scripts
npm run summarize
npm run summarize:force      # 强制重新分析
npm run summarize:dry-run    # 预览模式

# 方式 3: 直接运行 TypeScript
npx tsx summarize.ts --help
```

## 常用命令

```bash
# 增量分析（只分析新的 sessions）
./summarize.sh

# 强制重新分析所有 sessions
./summarize.sh --force

# 模拟运行（查看会做什么但不保存）
./summarize.sh --dry-run

# 只分析最近 5 个 sessions（测试用）
./summarize.sh --limit 5

# 禁用 LLM 增强（更快但质量较低）
./summarize.sh --no-llm

# 跳过自动清理和导出
./summarize.sh --no-cleanup --no-export

# 自定义 session 目录
./summarize.sh --session-dir /path/to/sessions

# 设置最低置信度阈值
./summarize.sh --min-confidence 0.7
```

## 所有选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--force` | 强制重新分析所有 sessions（忽略缓存） | false |
| `--session-dir <dir>` | 自定义 session 目录 | `~/.claude/sessions` |
| `--limit <n>` | 限制分析的 session 数量（用于测试） | 无限制 |
| `--min-confidence <n>` | 最低置信度阈值 | 0.6 |
| `--dry-run` | 模拟运行，不保存结果 | false |
| `--no-cleanup` | 跳过自动清理（合并重复规则等） | false |
| `--no-llm` | 禁用 LLM 增强（仅使用基础模式检测） | false |
| `--no-export` | 跳过导出到 claude-index.md | false |
| `--help`, `-h` | 显示帮助信息 | - |

## 典型使用场景

### 1. 每日增量分析（推荐）

```bash
# 每天运行一次，只分析新的 sessions
./summarize.sh
```

这是最常见的用法，脚本会自动跟踪已分析的 sessions，避免重复工作。

### 2. 完整重建规则库

```bash
# 清空现有规则，从头开始
rm -rf ~/.autoimprove/rules/*
./summarize.sh --force
```

适合重大版本升级或规则库损坏时使用。

### 3. 快速测试

```bash
# 只分析最近 5 个 sessions，不使用 LLM
./summarize.sh --limit 5 --no-llm
```

用于验证脚本是否正常工作，或快速测试新功能。

### 4. 预览模式

```bash
# 查看会检测到什么模式，但不保存
./summarize.sh --dry-run
```

适合在正式运行前预览结果。

## 设置定时任务

使用 cron 每天自动分析：

```bash
# 编辑 crontab
crontab -e

# 添加以下行（每天凌晨 2 点运行）
0 2 * * * cd /Users/adazhao/workspace/autoimprove && ./summarize.sh >> /tmp/autoimprove.log 2>&1
```

## 唯一方式

> ⚠️ `autoimprove-summarize` 技能已移除。现在只能通过 CLI 脚本执行 summarize。

| 特性 | CLI (`./summarize.sh`) |
|------|------------------------|
| 运行方式 | 命令行独立运行 |
| 适用场景 | 自动化、批量处理、定时任务 |
| 交互性 | 一次性执行 |
| 日志输出 | 输出到终端或日志文件 |

这是执行 summarize 的唯一方式。

## 输出示例

```
🚀 AutoImprove Summarize CLI

📦 Initializing storage...
   Found 277 existing rules

📊 Starting batch analysis...
   Scanning sessions: /Users/adazhao/.claude/sessions
   Found 150 sessions, 12 unanalyzed

   Analyzing: ████████████████████ 12/12 (100%)

📊 Analysis Results:
   Sessions analyzed: 12
   Patterns detected: 48
   Rules generated: 8

🧹 Cleanup Results:
   Rules merged: 2
   Rules optimized: 1

📤 Exporting to claude-index.md...
   Exported 10 rules
   Location: /Users/adazhao/.autoimprove/rules/claude-index.md

✅ Summarize complete!
   Total rules in database: 285
   Rules auto-loaded into Claude: ~/.autoimprove/rules/claude-index.md
```

## 故障排除

### 错误: tsx not found

```bash
npm install -g tsx
```

或者使用项目本地安装的版本：

```bash
npm install
```

### 错误: Session directory not found

检查 session 目录是否存在：

```bash
ls -la ~/.claude/sessions/
```

或使用 `--session-dir` 指定正确路径。

### 错误: ANTHROPIC_API_KEY not set

如果使用 LLM 增强，需要设置 API key：

```bash
export ANTHROPIC_API_KEY="your-api-key"
./summarize.sh
```

或者禁用 LLM：

```bash
./summarize.sh --no-llm
```

## 文件说明

- **`summarize.sh`** - Shell 脚本包装器，自动检查依赖并运行
- **`summarize.ts`** - TypeScript 实现，调用 MCP server 的 BatchRebuildEngine
- **`docs/CLI_SUMMARIZE.md`** - 完整文档
- **`package.json`** - 添加了 npm scripts（`summarize`, `summarize:force`, `summarize:dry-run`）

## 参考文档

- [docs/CLI_SUMMARIZE.md](docs/CLI_SUMMARIZE.md) - 完整使用指南
- [CLAUDE.md](CLAUDE.md) - 项目架构说明
- [docs/HYBRID_RULE_GENERATION.md](docs/HYBRID_RULE_GENERATION.md) - 规则生成详解

---

**下一步建议**：

1. 运行一次 `./summarize.sh --dry-run --limit 5` 测试是否正常工作
2. 如果正常，运行 `./summarize.sh` 进行完整分析
3. 设置 cron 定时任务实现自动化
