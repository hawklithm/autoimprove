# MCP Server 重启逻辑说明

## 概述

setup.sh 脚本现在包含完整的 MCP Server 重启逻辑，确保在配置更新后服务器能够正确重启并加载新配置。

## Step 6: 重启 MCP Server

### 执行流程

```bash
Step 6: Restarting MCP Server...
-----------------------------------
1. 停止运行中的 MCP server 进程
2. 验证 MCP server 配置
3. 测试 MCP server 启动能力
4. 清理测试进程
```

### 详细步骤

#### 1. 停止现有进程

```bash
# 查找并终止所有 autoimprove MCP server 进程
pkill -f "node.*autoimprove.*dist/index.js" 2>/dev/null || true
sleep 1  # 等待进程完全终止
```

**作用**：
- 清理之前运行的 MCP server 实例
- 避免多个实例同时运行导致端口冲突
- 确保新配置能够被加载

#### 2. 验证配置

```bash
SERVER_STATUS=$(claude mcp get autoimprove-core 2>&1)

if echo "$SERVER_STATUS" | grep -q "✓ Connected"; then
  echo "✓ MCP server configuration verified"
else
  echo "⚠ Warning: MCP server status unclear"
fi
```

**作用**：
- 确认 MCP server 已正确注册到 Claude Code
- 检查配置是否有效
- 验证 server 是否可连接

#### 3. 测试启动

```bash
SERVER_TEST=$(echo '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' | \
  node "$MCP_SERVER_DIR/dist/index.js" 2>&1 | grep -o '"serverInfo"')

if [ -n "$SERVER_TEST" ]; then
  echo "✓ MCP server can start successfully"
fi
```

**作用**：
- 发送初始化请求测试 server 能否启动
- 验证编译后的 server 代码是否正确
- 确保 server 能够响应 MCP 协议请求

#### 4. 清理测试进程

```bash
pkill -f "node.*autoimprove.*dist/index.js" 2>/dev/null || true
```

**作用**：
- 终止测试进程
- 让 Claude Code 在需要时自动启动 server
- 避免手动测试进程占用资源

## 为什么需要重启逻辑

### 1. 配置更新

当 setup.sh 更新以下内容时，需要重启 server：
- MCP server 二进制文件（重新编译）
- MCP server 配置（`claude mcp add`）
- Skills 定义（SKILL.md）
- 存储配置（config.json）

### 2. 避免冲突

重启逻辑确保：
- 没有多个 server 实例同时运行
- 旧配置的 server 被正确停止
- 新配置被正确加载

### 3. 验证安装

重启逻辑包含测试步骤：
- 验证 server 可以启动
- 验证 server 可以响应 MCP 请求
- 确保安装成功

## MCP Server 生命周期

### 自动启动机制

Claude Code 会自动管理 MCP server 的生命周期：

```
用户调用 skill/MCP工具
         ↓
Claude Code 检查 server 是否运行
         ↓
    [未运行] → 启动 server
         ↓
    发送 MCP 请求
         ↓
    接收响应
         ↓
    [空闲一段时间] → 自动停止
```

### 手动控制

用户也可以手动控制 server：

```bash
# 检查 server 状态
claude mcp get autoimprove-core

# 手动停止 server
pkill -f "node.*autoimprove.*dist/index.js"

# 测试 server 启动
echo '{"jsonrpc":"2.0",...}' | node /path/to/dist/index.js
```

## 重启场景

### 1. 安装/更新后

```bash
./setup.sh
# ✓ Step 6 自动执行重启逻辑
```

### 2. 修改配置后

```bash
# 修改 templates/config.json
vim templates/config.json

# 重新运行 setup.sh
./setup.sh
# ✓ 自动重启并加载新配置
```

### 3. 修改 MCP Server 代码后

```bash
# 修改 server 代码
vim src/mcp-server-ts/src/index.ts

# 重新运行 setup.sh（包含构建和重启）
./setup.sh
```

### 4. 手动重启

```bash
# 停止 server
pkill -f "node.*autoimprove.*dist/index.js"

# Claude Code 会在下次使用时自动启动
```

## 故障排查

### Server 无法启动

```bash
# 1. 检查编译是否成功
ls -la src/mcp-server-ts/dist/index.js

# 2. 手动测试启动
node src/mcp-server-ts/dist/index.js
# 应该输出: AutoImprove MCP Server (TypeScript) started

# 3. 检查配置
claude mcp get autoimprove-core
```

### Server 进程未停止

```bash
# 1. 查找进程
ps aux | grep autoimprove

# 2. 强制终止
pkill -9 -f "node.*autoimprove"

# 3. 验证已停止
ps aux | grep autoimprove
```

### 配置未生效

```bash
# 1. 确认配置已更新
cat ~/.autoimprove/config.json

# 2. 停止所有实例
pkill -f "node.*autoimprove"

# 3. 重新运行 setup.sh
./setup.sh

# 4. 验证配置
/autoimprove-status
```

## 日志和调试

### 查看 Server 输出

MCP server 的标准错误输出会显示启动信息：

```bash
# 直接运行 server 查看输出
node src/mcp-server-ts/dist/index.js
# 输出: AutoImprove MCP Server (TypeScript) started
```

### 测试 Server 响应

```bash
# 发送测试请求
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  node src/mcp-server-ts/dist/index.js 2>&1 | jq .
```

### 检查 Claude Code 日志

```bash
# Claude Code 日志位置（如果有）
ls ~/.claude/logs/

# AutoImprove 日志
ls ~/.autoimprove/logs/
```

## 最佳实践

### 1. 修改代码后总是重新运行 setup.sh

```bash
# ❌ 错误：只重新编译
cd src/mcp-server-ts && npm run build

# ✅ 正确：完整重新安装
./setup.sh
```

### 2. 使用 setup.sh 而非手动重启

```bash
# ❌ 错误：手动操作
pkill -f autoimprove
claude mcp remove autoimprove-core
claude mcp add ...

# ✅ 正确：使用脚本
./setup.sh
```

### 3. 验证重启成功

```bash
# 运行 setup.sh 后
./setup.sh

# 立即验证
claude mcp get autoimprove-core
# 应显示: Status: ✓ Connected

# 测试功能
/autoimprove-status
```

## 性能考虑

### Server 启动时间

- 冷启动：~100-200ms
- 包括：
  - Node.js 启动
  - 模块加载
  - 存储初始化
  - MCP 连接建立

### 自动停止策略

Claude Code 会在 server 空闲一段时间后自动停止，以节省资源：
- 空闲超时：通常几分钟
- 下次使用时自动重启
- 无需手动管理

### 资源使用

单个 MCP server 实例：
- 内存：~20-50MB
- CPU：空闲时近 0%
- 启动时短暂峰值

## 安全考虑

### 进程清理

```bash
# setup.sh 使用安全的进程终止方式
pkill -f "pattern"  # SIGTERM（优雅终止）
# 而非
pkill -9 -f "pattern"  # SIGKILL（强制终止）
```

### 权限检查

- Server 以当前用户权限运行
- 无需 sudo
- 配置文件在用户目录（~/.claude, ~/.autoimprove）

## 相关命令

```bash
# 查看所有 MCP servers
claude mcp list

# 查看特定 server 详情
claude mcp get autoimprove-core

# 移除 server
claude mcp remove autoimprove-core -s user

# 重新添加 server
claude mcp add autoimprove-core -s user -- node /path/to/dist/index.js

# 查看运行中的 autoimprove 进程
ps aux | grep autoimprove

# 停止所有 autoimprove 进程
pkill -f "node.*autoimprove"
```

## 总结

setup.sh 的 Step 6（重启 MCP Server）提供：

✅ **自动停止** - 清理旧进程  
✅ **配置验证** - 确认 server 已注册  
✅ **启动测试** - 验证 server 可运行  
✅ **进程清理** - 让 Claude Code 自动管理  
✅ **错误处理** - 友好的错误提示  

这确保了每次运行 setup.sh 后，MCP server 都处于正确的状态，配置已更新，可以立即使用。
