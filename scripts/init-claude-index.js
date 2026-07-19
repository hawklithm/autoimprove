#!/usr/bin/env node
/**
 * Initialize claude-index.md with initial content
 *
 * This script generates the initial ~/.autoimprove/rules/claude-index.md file
 * that will be referenced from ~/.claude/CLAUDE.md
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const STORAGE_ROOT = process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
const CLAUDE_INDEX_PATH = join(STORAGE_ROOT, "rules", "claude-index.md");

function initClaudeIndex() {
  // Ensure directory exists
  const dir = join(CLAUDE_INDEX_PATH, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Create initial content
  const content = `# AutoImprove Learned Rules

> 这些规则从你的编码习惯中自动学习。规则会根据当前工作场景自动匹配。

## 开始使用

目前还没有生成规则。请运行以下命令开始学习：

\`\`\`bash
npm run summarize
\`\`\`

或在 autoimprove 仓库目录下：
\`\`\`bash
tsx summarize.ts
\`\`\`

AutoImprove 会分析你的 Claude Code 会话记录，识别编码模式，并自动生成规则。

---

💡 **动态匹配**: Claude 会根据你当前的代码场景自动应用相关规则。
📊 **完整规则库**: 运行 \`/autoimprove-rules\` 查看全部规则。
🔄 **自动更新**: 每次运行 \`npm run summarize\` 后，此文件会自动更新。
`;

  writeFileSync(CLAUDE_INDEX_PATH, content, "utf-8");
  console.log(`✓ Created initial claude-index.md at: ${CLAUDE_INDEX_PATH}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initClaudeIndex();
}

export { initClaudeIndex };
