# AutoImprove CLI Summarize - Quick Reference

✅ **创建成功！** 你现在有了一个命令行工具来执行 summarize 功能。

## 三种使用方式

```bash
# 1. Shell 脚本（最简单，推荐）
./summarize.sh

# 2. NPM Scripts
npm run summarize
npm run summarize:force
npm run summarize:dry-run

# 3. 直接运行 TypeScript
./summarize.ts
npx tsx summarize.ts
```

## 快速开始

```bash
# 查看帮助
./summarize.sh --help

# 测试运行（不保存，只看结果）
./summarize.sh --dry-run --limit 5 --no-llm

# 正式运行（分析所有未分析的 sessions）
./summarize.sh
```

## 常用选项

```bash
--force              # 强制重新分析所有
--dry-run            # 预览模式
--limit 10           # 只分析 10 个 sessions
--no-llm             # 禁用 LLM（更快）
--no-cleanup         # 跳过规则清理
--no-export          # 跳过导出 claude-index.md
--session-dir <dir>  # 自定义 session 目录
--min-confidence 0.7 # 设置最低置信度
```

## 典型场景

### 每日增量分析
```bash
./summarize.sh
```

### 完整重建
```bash
rm -rf ~/.autoimprove/rules/*
./summarize.sh --force
```

### 快速测试
```bash
./summarize.sh --limit 5 --no-llm --dry-run
```

## 定时任务

```bash
# 每天凌晨 2 点自动运行
crontab -e
# 添加: 0 2 * * * cd ~/workspace/autoimprove && ./summarize.sh >> /tmp/autoimprove.log 2>&1
```

## 文件说明

- **`summarize.sh`** - Shell 包装器
- **`summarize.ts`** - TypeScript 实现
- **`README_CLI_SUMMARIZE.md`** - 完整文档
- **`docs/CLI_SUMMARIZE.md`** - 详细指南

## 测试结果

✅ `./summarize.sh --help` - 正常
✅ `npm run summarize:dry-run` - 正常
✅ Shell 脚本和 NPM scripts 都可以工作

## 与 `/autoimprove-summarize` 的区别

- **CLI 脚本**: 独立运行，适合自动化和定时任务
- **Skill 命令**: 在 Claude Code 中运行，适合临时分析

两者完全兼容，使用同一套代码。

---

📖 更多详情见 [README_CLI_SUMMARIZE.md](README_CLI_SUMMARIZE.md)
