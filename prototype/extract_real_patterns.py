#!/usr/bin/env python3
"""
从真实的 Claude Code 会话记录中提取 Pattern

这个脚本会：
1. 解析 JSONL 格式的会话文件
2. 识别用户消息和工具调用
3. 查找重复修正、测试失败等模式
4. 生成可用于测试的 Pattern 数据
"""

import json
import sys
from pathlib import Path
from collections import defaultdict
from datetime import datetime


def parse_session_file(file_path):
    """解析会话文件"""

    messages = []
    tool_calls = []
    edits = []

    with open(file_path, 'r') as f:
        for line_num, line in enumerate(f, 1):
            try:
                data = json.loads(line)

                # 提取用户消息
                if data.get('role') == 'user':
                    content = data.get('content', '')
                    if content and len(content) > 10:
                        messages.append({
                            'line': line_num,
                            'role': 'user',
                            'content': content[:500],  # 限制长度
                            'timestamp': data.get('timestamp', '')
                        })

                # 提取助手消息
                elif data.get('role') == 'assistant':
                    content = data.get('content', '')
                    if content:
                        messages.append({
                            'line': line_num,
                            'role': 'assistant',
                            'content': content[:500],
                            'timestamp': data.get('timestamp', '')
                        })

                # 提取工具调用
                elif data.get('type') == 'tool_use':
                    tool_calls.append({
                        'line': line_num,
                        'tool': data.get('name', ''),
                        'input': data.get('input', {}),
                        'timestamp': data.get('timestamp', '')
                    })

            except json.JSONDecodeError:
                continue
            except Exception as e:
                print(f"Warning: Error parsing line {line_num}: {e}", file=sys.stderr)
                continue

    return {
        'messages': messages,
        'tool_calls': tool_calls,
        'edits': edits
    }


def analyze_patterns(session_data):
    """分析会话数据，查找模式"""

    patterns = []
    messages = session_data['messages']

    # 查找重复的关键词/主题
    user_messages = [m for m in messages if m['role'] == 'user']

    print(f"\n找到 {len(user_messages)} 条用户消息")
    print(f"找到 {len(session_data['tool_calls'])} 次工具调用")

    # 显示前 10 条用户消息
    print("\n前 10 条用户消息:")
    for i, msg in enumerate(user_messages[:10], 1):
        content = msg['content'].replace('\n', ' ')[:100]
        print(f"{i}. {content}...")

    # 查找修正模式（包含"不对"、"改成"、"应该"等词）
    correction_keywords = ['不对', '不是', '改成', '应该', '修正', '修改', 'fix', 'change', 'should']
    corrections = []

    for msg in user_messages:
        content = msg['content'].lower()
        if any(kw in content for kw in correction_keywords):
            corrections.append(msg)

    print(f"\n找到 {len(corrections)} 条可能的修正消息:")
    for i, msg in enumerate(corrections[:5], 1):
        content = msg['content'].replace('\n', ' ')[:150]
        print(f"{i}. {content}...")

    # 查找偏好模式（包含"我们"、"团队"、"习惯"等词）
    preference_keywords = ['我们', '团队', '习惯', '喜欢', '约定', 'we', 'team', 'prefer']
    preferences = []

    for msg in user_messages:
        content = msg['content'].lower()
        if any(kw in content for kw in preference_keywords):
            preferences.append(msg)

    print(f"\n找到 {len(preferences)} 条可能的偏好消息:")
    for i, msg in enumerate(preferences[:5], 1):
        content = msg['content'].replace('\n', ' ')[:150]
        print(f"{i}. {content}...")

    # 查找性能相关
    performance_keywords = ['性能', '优化', '慢', '卡', 'performance', 'optimize', 'slow', 'lag']
    performance = []

    for msg in user_messages:
        content = msg['content'].lower()
        if any(kw in content for kw in performance_keywords):
            performance.append(msg)

    print(f"\n找到 {len(performance)} 条可能的性能相关消息:")
    for i, msg in enumerate(performance[:5], 1):
        content = msg['content'].replace('\n', ' ')[:150]
        print(f"{i}. {content}...")

    # 查找安全相关
    security_keywords = ['安全', '注入', '漏洞', 'security', 'injection', 'vulnerability', 'xss', 'csrf']
    security = []

    for msg in user_messages:
        content = msg['content'].lower()
        if any(kw in content for kw in security_keywords):
            security.append(msg)

    print(f"\n找到 {len(security)} 条可能的安全相关消息:")
    for i, msg in enumerate(security[:5], 1):
        content = msg['content'].replace('\n', ' ')[:150]
        print(f"{i}. {content}...")

    return patterns


def main():
    """主函数"""

    if len(sys.argv) < 2:
        print("用法: python3 extract_real_patterns.py <session_file.jsonl>")
        sys.exit(1)

    file_path = Path(sys.argv[1])

    if not file_path.exists():
        print(f"错误: 文件不存在: {file_path}")
        sys.exit(1)

    print(f"解析会话文件: {file_path}")
    print(f"文件大小: {file_path.stat().st_size / 1024:.1f} KB")

    # 解析会话
    session_data = parse_session_file(file_path)

    # 分析模式
    patterns = analyze_patterns(session_data)

    print("\n" + "=" * 80)
    print("分析完成")
    print("=" * 80)


if __name__ == "__main__":
    main()
