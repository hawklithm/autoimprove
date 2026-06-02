# 模板化架构说明

## 概述

AutoImprove 项目现在使用模板文件来管理所有配置和 Skills，而不是在 setup.sh 中硬编码。这使得维护和定制更加容易。

## 目录结构

```
autoimprove/
├── setup.sh                          # 安装脚本（使用模板）
├── templates/                        # 📁 模板目录
│   ├── README.md                    # 模板文档
│   ├── config.json                  # 默认配置模板
│   └── rules-index.json             # 规则索引模板
├── src/
│   ├── mcp-server-ts/               # MCP Server 源代码
│   └── skills-ts/                   # Skills 源代码
│       └── src/
│           ├── autoimprove-status/
│           │   └── SKILL.md         # Skill 模板
│           ├── autoimprove-summarize/
│           │   └── SKILL.md
│           ├── autoimprove-rules/
│           │   └── SKILL.md
│           └── autoimprove-lessons/
│               └── SKILL.md
└── README.md
```

## 模板文件

### 1. 配置模板

**`templates/config.json`**
- 用途：AutoImprove 系统默认配置
- 安装位置：`~/.autoimprove/config.json`
- 包含：
  - 置信度阈值（各类模式的最低置信度）
  - 置信度权重（计算组件的权重）
  - 规则匹配参数
  - 业务域映射

**`templates/rules-index.json`**
- 用途：规则索引初始文件
- 安装位置：`~/.autoimprove/rules/index.json`
- 包含：空规则列表

### 2. Skill 模板

**`src/skills-ts/src/*/SKILL.md`**
- 用途：定义 Skill 的行为和指令
- 安装位置：`~/.claude/skills/*/SKILL.md`
- 格式：
  ```markdown
  ---
  name: skill-name
  description: Skill description
  allowed-tools: mcp__autoimprove-core__*
  ---
  
  # Skill Instructions
  
  [Claude Code 读取这里的指令来执行 Skill]
  ```

## setup.sh 中的使用

### 之前（硬编码）

```bash
# ❌ 硬编码在脚本中
cat > "$AUTOIMPROVE_DIR/config.json" <<EOF
{
  "version": "1.0",
  "confidence_thresholds": {
    "repeated-correction": 0.45,
    ...
  }
}
EOF
```

### 现在（使用模板）

```bash
# ✅ 从模板复制
if [ -f "$TEMPLATES_DIR/config.json" ]; then
  cp "$TEMPLATES_DIR/config.json" "$AUTOIMPROVE_DIR/config.json"
  echo "✓ Created default config from template"
fi
```

## 优势

### ✅ 易于维护
- 所有模板集中管理
- 修改模板文件即可，无需编辑脚本
- 清晰的文件结构

### ✅ 易于定制
- 用户可以在安装前修改模板
- 可以创建多个模板变体
- 版本控制更清晰

### ✅ 易于测试
- 可以独立测试模板文件的有效性
- 脚本逻辑更简洁
- 减少脚本中的错误可能性

### ✅ 易于文档化
- 每个模板都有自己的文档
- 模板即文档
- 用户可以直接查看和理解配置

## 如何定制

### 修改默认配置

1. 编辑 `templates/config.json`：
```bash
vim templates/config.json
# 修改阈值、权重等参数
```

2. 重新运行安装：
```bash
./setup.sh
```

### 修改 Skill 行为

1. 编辑 Skill 模板：
```bash
vim src/skills-ts/src/autoimprove-status/SKILL.md
# 修改 Skill 指令
```

2. 重新安装 Skills：
```bash
./setup.sh  # 会重新复制所有 SKILL.md
```

### 创建自定义模板变体

```bash
# 创建自定义配置
cp templates/config.json templates/config-strict.json
# 编辑 config-strict.json，提高阈值

# 使用自定义配置安装
cp templates/config-strict.json ~/.autoimprove/config.json
```

## 更新现有安装

### 更新配置
```bash
# 备份现有配置
cp ~/.autoimprove/config.json ~/.autoimprove/config.json.backup

# 应用新模板
cp templates/config.json ~/.autoimprove/config.json

# 或者手动合并更改
```

### 更新 Skills
```bash
# 重新运行 setup.sh 会自动更新所有 Skills
./setup.sh
```

## 版本控制

模板文件都纳入 Git 版本控制：

```bash
git add templates/
git add src/skills-ts/src/*/SKILL.md
git commit -m "Update templates"
```

用户的实际配置文件（`~/.autoimprove/`）不纳入版本控制。

## 最佳实践

1. **修改模板前先备份**
   ```bash
   cp templates/config.json templates/config.json.backup
   ```

2. **使用 JSON 验证工具**
   ```bash
   python3 -m json.tool templates/config.json
   ```

3. **测试模板有效性**
   ```bash
   # 在测试环境中先验证
   AUTOIMPROVE_DIR=/tmp/autoimprove-test ./setup.sh
   ```

4. **文档化定制内容**
   - 在 `templates/README.md` 中记录你的修改
   - 说明为什么修改以及影响

## 相关文件

- `setup.sh` - 使用模板的安装脚本
- `templates/README.md` - 模板详细文档
- `README.md` - 项目主文档
- `CHANGELOG.md` - 变更日志

## 技术细节

### 模板变量

setup.sh 中定义的路径变量：
```bash
SCRIPT_DIR="..."              # 项目根目录
TEMPLATES_DIR="$SCRIPT_DIR/templates"  # 模板目录
AUTOIMPROVE_DIR="$HOME/.autoimprove"   # 安装目标
CLAUDE_DIR="$HOME/.claude"             # Claude Code 目录
SKILLS_DIR_SRC="$SCRIPT_DIR/src/skills-ts"  # Skills 源目录
```

### 复制逻辑

```bash
# 配置文件：仅在不存在时创建
if [ ! -f "$AUTOIMPROVE_DIR/config.json" ]; then
  cp "$TEMPLATES_DIR/config.json" "$AUTOIMPROVE_DIR/config.json"
fi

# Skills：始终覆盖（确保更新）
cp "$skill_src/SKILL.md" "$skill_install/"
```

## 故障排查

### 模板文件找不到
```bash
# 检查模板目录
ls -la templates/

# 验证路径变量
echo $TEMPLATES_DIR
```

### 配置文件格式错误
```bash
# 验证 JSON 格式
python3 -m json.tool templates/config.json

# 或使用 jq
jq . templates/config.json
```

### Skills 没有更新
```bash
# 清理并重新安装
rm -rf ~/.claude/skills/autoimprove-*
./setup.sh
```

## 未来扩展

可能的模板扩展方向：

1. **多环境模板**
   - `config-dev.json` - 开发环境
   - `config-prod.json` - 生产环境
   - `config-test.json` - 测试环境

2. **行业特定模板**
   - `config-fintech.json` - 金融科技
   - `config-ecommerce.json` - 电商
   - `config-saas.json` - SaaS

3. **自定义 Skills**
   - 用户可以创建自己的 SKILL.md
   - 放在 `templates/custom-skills/` 目录

4. **配置生成器**
   - 交互式配置生成工具
   - 根据用户需求自动生成模板
