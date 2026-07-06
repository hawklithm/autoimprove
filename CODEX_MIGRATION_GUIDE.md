# AutoImprove → Codex 改造方案

## 概述
本方案将现有的 AutoImprove 工程改造为支持 Codex 的 skill 和 MCP 体系。

## 改造内容

### 1. 目录结构调整

#### 原有结构
```
autoimprove/
├── setup.sh
├── .mcp.json
├── src/
│   └── autoimprove_mcp_server.py
└── skills/ (不存在)
```

#### 新结构
```
autoimprove/
├── setup.sh                    # 通用安装脚本
├── .mcp.json                   # MCP 服务器配置
├── codex-skills-config.json    # Codex skills 配置（新增）
├── src/
│   └── autoimprove_mcp_server.py
├── skills/                     # Codex skills 目录（新增）
│   ├── autoimprove-rules/
│   │   ├── prompt.md          # skill 提示词
│   │   ├── skill.json         # skill 元数据
│   │   └── skill.sh           # skill 执行脚本
│   ├── code-review/
│   │   ├── prompt.md
│   │   ├── skill.json
│   │   └── skill.sh
│   └── code-apply-fix/
│       ├── prompt.md
│       ├── skill.json
│       └── skill.sh
└── docs/
    └── CODEX_MIGRATION_GUIDE.md  # 本文档
```

### 2. 配置文件改造

#### .mcp.json (保持不变)
```json
{
  "mcpServers": {
    "autoimprove": {
      "type": "stdio",
      "command": "python3",
      "args": ["./src/autoimprove_mcp_server.py"],
      "description": "AutoImprove MCP Server - 代码规则学习和修复工具"
    }
  }
}
```

#### codex-skills-config.json (新增)
定义所有 skills 及其与 MCP 的绑定关系。

格式：
```json
{
  "version": "1.0",
  "skills": [
    {
      "name": "skill-name",
      "description": "skill 描述",
      "path": "./skills/skill-name",
      "mcp": {
        "server": "mcp-server-name",
        "tools": ["tool1", "tool2"]
      }
    }
  ]
}
```

### 3. Skill 定义规范

每个 skill 包含三个文件：

#### a) skill.json - 元数据
```json
{
  "name": "skill-name",
  "version": "1.0.0",
  "description": "skill 描述",
  "author": "author name",
  "tags": ["tag1", "tag2"],
  "mcp": {
    "server": "mcp-server-name",
    "tools": ["tool1", "tool2"]
  }
}
```

#### b) prompt.md - 提示词
Markdown 格式，定义 skill 的使用指南、工作流程等。

#### c) skill.sh - 执行脚本
Bash 脚本，实现 skill 的命令行调用接口。

### 4. MCP 服务器改造

#### 现有 MCP 工具
- `search_rules(context, issue_description)` - 搜索相关规则
- `learn_from_edit(file_path, line_number, original_code, edited_code, description)` - 从编辑中学习
- `update_rules(rule_id, updates)` - 更新规则
- `analyze_code(file_path, content)` - 分析代码
- `apply_fix(file_path, line_number, rule_id, fixed_code)` - 应用修复

#### 新增要求
1. **工具注释规范**：每个工具添加详细的 docstring
2. **错误处理**：统一错误响应格式
3. **日志记录**：记录工具调用日志
4. **参数验证**：验证输入参数合法性

示例改造：
```python
@server.tool("search_rules")
def search_rules(context: str, issue_description: str) -> str:
    """
    搜索与问题描述相关的代码规则
    
    Args:
        context: 代码上下文（可选）
        issue_description: 问题描述
    
    Returns:
        匹配的规则列表（JSON 格式）
    
    Raises:
        ValueError: 参数验证失败
        RuntimeError: 搜索失败
    """
    try:
        # 参数验证
        if not issue_description:
            raise ValueError("issue_description 不能为空")
        
        # 实现逻辑
        # ...
        
        return json.dumps(result)
    except Exception as e:
        logger.error(f"search_rules 失败: {e}")
        return json.dumps({"error": str(e)})
```

### 5. setup.sh 改造

#### 原有功能
- 安装 Node.js 依赖
- 编译 TypeScript
- 安装 Python 虚拟环境
- 启动 MCP 服务器

#### 新增功能
```bash
#!/bin/bash
# Codex 兼容的 setup 脚本

set -e

echo "🚀 AutoImprove Codex 安装向导"
echo "================================"

# 检测包管理器
detect_package_manager() {
    if command -v npm &> /dev/null; then
        echo "npm"
    elif command -v yarn &> /dev/null; then
        echo "yarn"
    else
        echo "none"
    fi
}

# 安装依赖
install_dependencies() {
    local pm=$(detect_package_manager)
    
    case $pm in
        npm)
            echo "📦 使用 npm 安装依赖..."
            npm install
            ;;
        yarn)
            echo "📦 使用 yarn 安装依赖..."
            yarn install
            ;;
        *)
            echo "❌ 未找到包管理器，请安装 npm 或 yarn"
            exit 1
            ;;
    esac
}

# 编译 TypeScript (如果有)
build_typescript() {
    if [ -f "tsconfig.json" ]; then
        echo "🔨 编译 TypeScript..."
        npx tsc
    fi
}

# 设置 Python 环境
setup_python() {
    echo "🐍 设置 Python 虚拟环境..."
    
    if [ ! -d "venv" ]; then
        python3 -m venv venv
    fi
    
    source venv/bin/activate
    pip install -r requirements.txt
}

# 配置 Codex (新增)
configure_codex() {
    echo "⚙️  配置 Codex..."
    
    # 创建 skills 目录
    mkdir -p skills
    
    # 检查配置文件
    if [ ! -f "codex-skills-config.json" ]; then
        echo "⚠️  未找到 codex-skills-config.json"
        echo "   请手动创建配置文件"
    fi
    
    # 验证 MCP 配置
    if [ ! -f ".mcp.json" ]; then
        echo "❌ 未找到 .mcp.json"
        exit 1
    fi
    
    echo "✅ Codex 配置完成"
}

# 主流程
main() {
    install_dependencies
    build_typescript
    setup_python
    configure_codex
    
    echo ""
    echo "🎉 安装完成！"
    echo ""
    echo "下一步："
    echo "  1. 启动 MCP 服务器: ./restart-mcp.sh"
    echo "  2. 在 Codex 中加载 skills: codex skills load ./codex-skills-config.json"
    echo "  3. 使用 skill: codex skill run autoimprove-rules --help"
}

main "$@"
```

### 6. 使用示例

#### 在 Codex 中使用 skill

**方式 1：命令行**
```bash
# 加载 skills
codex skills load ./codex-skills-config.json

# 查看可用 skills
codex skills list

# 运行 skill
codex skill run autoimprove-rules --help
codex skill run code-review --file src/main.py
codex skill run code-apply-fix --issue-id 123
```

**方式 2：在 Codex 会话中**
```
> @autoimprove-rules 搜索与"空指针判断"相关的规则
> @code-review 审查 src/main.py
> @code-apply-fix 修复问题 #123
```

#### Skill 调用 MCP 工具

在 skill.sh 中通过 MCP 客户端调用：
```bash
#!/bin/bash
# 调用 MCP 工具 search_rules

# 方式 1: 使用 mcpx CLI
mcpx call autoimprove search_rules \
  --context "function process_data()" \
  --issue-description "缺少空指针判断"

# 方式 2: 使用 curl (如果 MCP 提供 HTTP 接口)
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "search_rules",
    "args": {
      "context": "function process_data()",
      "issue_description": "缺少空指针判断"
    }
  }'
```

### 7. 测试方案

#### 单元测试
```bash
# 测试 MCP 工具
python3 -m pytest tests/test_mcp_tools.py

# 测试 skill 脚本
bash -n skills/*/skill.sh  # 语法检查
skills/autoimprove-rules/skill.sh --help
```

#### 集成测试
```bash
# 启动 MCP 服务器
./restart-mcp.sh

# 测试 MCP 工具调用
mcpx call autoimprove search_rules --issue-description "test"

# 测试 skill 执行
codex skill run autoimprove-rules --help
```

### 8. 迁移检查清单

- [ ] 创建 `skills/` 目录结构
- [ ] 定义 `skill.json` 元数据文件
- [ ] 编写 `prompt.md` 提示词文件
- [ ] 实现 `skill.sh` 执行脚本
- [ ] 创建 `codex-skills-config.json` 配置文件
- [ ] 改造 `setup.sh` 支持 Codex
- [ ] 优化 MCP 服务器工具定义
- [ ] 添加错误处理和日志记录
- [ ] 编写单元测试
- [ ] 更新文档（README.md）
- [ ] 测试完整流程

### 9. 后续优化建议

1. **Skill 市场**：将 skills 发布到 Codex skill 市场
2. **MCP 工具扩展**：添加更多代码分析工具
3. **Web UI**：开发 skill 和规则的管理界面
4. **多语言支持**：扩展支持更多编程语言
5. **AI 模型集成**：集成更强大的代码分析模型

## 附录

### A. 参考资料
- Codex Skill 开发文档: [链接]
- MCP 协议规范: https://modelcontextprotocol.io
- FastMCP 框架: https://github.com/fastmcp/fastmcp

### B. 常见问题

**Q: skill 和 MCP 工具的关系是什么？**
A: Skill 是用户交互层，MCP 工具是能力层。Skill 通过调用 MCP 工具实现具体功能。

**Q: 如何调试 skill？**
A: 使用 `bash -x skill.sh` 查看执行过程，或添加 `set -e` 和日志输出。

**Q: MCP 服务器如何支持多用户？**
A: 使用进程隔离或容器化技术，为每个用户启动独立的 MCP 服务器实例。

---

**文档版本**: 1.0  
**最后更新**: 2026-07-05  
**作者**: AutoImprove Team
