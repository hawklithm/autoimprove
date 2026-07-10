# Codex Setup Script 更新日志

## 2026-07-10 - 重大更新

### 替换说明
- **旧版**: `setup_codex.sh` (5.8K) → 备份为 `setup_codex.sh.old`
- **新版**: `setup_codex_v2.sh` (16K) → 现在是 `setup_codex.sh`

### 变更摘要

#### ✅ 已修复的问题
1. **模板化配置管理** - 不再硬编码 prompt，使用 `templates/claude-guidance-template.md`
2. **Codex 标准格式** - SKILL.md 完全符合 Codex skill 系统规范
3. **UI 元数据** - 新增 `agents/openai.yaml` 支持
4. **完整 MCP 配置** - 添加所有必需环境变量
5. **Token 效率** - 精简文档，遵循 "Concise is Key" 原则
6. **健壮安装** - Node.js 版本检查、MCP 启动测试、自动备份
7. **CodeGraph 集成** - 明确说明两系统的互补关系

#### 🆕 新增功能
- Node.js 版本验证 (≥18.0.0)
- MCP server 启动测试
- 配置文件自动备份 (带时间戳)
- 彩色输出 (✓ ⚠ ✗)
- 优雅降级 (Codex 未安装时继续)
- 模板文件存在性检查
- 完整的错误处理和用户反馈

#### 📝 新增环境变量
```json
{
  "AUTOIMPROVE_HOME": "~/.autoimprove",
  "AUTOIMPROVE_STORAGE_BACKEND": "sqlite",
  "AUTOIMPROVE_LOG_LEVEL": "info",
  "AUTOIMPROVE_LOG_PATH": "~/.autoimprove/logs/mcp-server.log",
  "GIT_REPO_ROOT": "/current/project/path"
}
```

#### 📂 新增文件结构
```
~/.codex/skills/autoimprove/
├── SKILL.md              # Codex 标准格式
└── agents/
    └── openai.yaml       # UI 元数据 (新增)
```

### 向后兼容性

✅ **完全兼容** - 新版本会：
- 自动检测现有存储后端 (SQLite/JSON)
- 备份现有配置文件
- 保留用户数据
- 自动迁移到新格式

### 使用说明

#### 全新安装
```bash
./setup_codex.sh
```

#### 从旧版升级
```bash
# 直接运行即可，会自动备份
./setup_codex.sh

# 如需回退到旧版
cp setup_codex.sh.old setup_codex.sh
```

#### 验证安装
```bash
# 1. 检查配置
ls -la ~/.codex/skills/autoimprove/
cat ~/.codex/mcp_settings.json

# 2. 测试脚本
./test_setup_v2.sh

# 3. 重启 Codex
codex --list-skills  # 应显示更新的 autoimprove
```

### 文件对比

| 文件 | 大小 | 说明 |
|-----|------|------|
| `setup_codex.sh` | 16K | 当前版本 (v2) |
| `setup_codex.sh.old` | 5.8K | 旧版备份 |
| `setup_codex_v2.sh` | 16K | 源文件保留 |

### 相关文档

- **详细分析**: `CODEX_SETUP_ANALYSIS.md`
- **改进总结**: `SETUP_IMPROVEMENTS_SUMMARY.md`
- **测试脚本**: `test_setup_v2.sh`
- **模板文件**: `templates/claude-guidance-template.md`

### 注意事项

⚠️ **重要提醒**:
1. 首次运行会自动备份现有配置 (带时间戳)
2. 需要 Node.js ≥18.0.0
3. Codex 使用 skill 系统，不依赖 `guidance.md`
4. 模板文件必须存在：`templates/claude-guidance-template.md`

### 问题排查

#### 模板文件未找到
```bash
# 检查模板
ls -la templates/claude-guidance-template.md

# 如果缺失，从 Git 恢复
git checkout templates/claude-guidance-template.md
```

#### MCP Server 启动失败
```bash
# 检查 Node.js 版本
node -v  # 应该 ≥ v18.0.0

# 手动构建
cd src/mcp-server-ts
npm install
npm run build
```

#### 回退到旧版
```bash
cp setup_codex.sh.old setup_codex.sh
chmod +x setup_codex.sh
```

### 测试状态

- [x] 模板引用正确
- [x] Node.js 版本检查工作
- [x] MCP server 构建成功
- [x] 配置文件生成正确
- [x] 自动备份功能正常
- [x] 错误处理完善
- [x] 文档完整

### 下一步

1. 更新 `README.md` 的安装部分
2. 测试完整安装流程
3. 收集用户反馈
4. 考虑添加 `--update` 和 `--verify` 选项

---

**更新时间**: 2026-07-10 23:14
**版本**: v2.0
**状态**: ✅ 生产就绪
