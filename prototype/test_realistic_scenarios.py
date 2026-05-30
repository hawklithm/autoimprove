#!/usr/bin/env python3
"""
AutoImprove 原型 - 真实场景测试

基于实际使用经验构造的测试场景，包括：
1. 边界情况
2. 低置信度场景
3. 模糊的模式
4. 冲突的规则
"""

import sys
sys.path.append('.')
from session_analyzer import (
    Pattern, PatternType, PatternOccurrence, Scene,
    calculate_confidence, should_generate_rule, determine_priority
)


def create_realistic_test_patterns():
    """创建更真实的测试 Pattern"""

    patterns = []

    # ========================================================================
    # 场景 1: 单次会话的重复修正（边界情况）
    # ========================================================================
    patterns.append(Pattern(
        type=PatternType.REPEATED_CORRECTION,
        description="useState 初始值应该用函数形式，避免每次渲染都计算",
        occurrences=[
            PatternOccurrence(
                session_id="session-real-001",
                timestamp="2026-05-30T10:00:00Z",
                user_action="explicit_correction",
                context="src/components/Dashboard.tsx",
                test_passed=True,
                user_input="useState 的初始值用函数形式"
            ),
        ],
        first_seen="2026-05-30T10:00:00Z",
        last_seen="2026-05-30T10:00:00Z",
    ))

    # ========================================================================
    # 场景 2: 没有明确关键词的偏好
    # ========================================================================
    patterns.append(Pattern(
        type=PatternType.PREFERENCE,
        description="使用 const 而不是 let",
        occurrences=[
            PatternOccurrence(
                session_id="session-real-002",
                timestamp="2026-05-30T11:00:00Z",
                user_action="accept",
                context="src/utils/helpers.ts",
                user_input="改成 const"
            ),
        ],
        first_seen="2026-05-30T11:00:00Z",
        last_seen="2026-05-30T11:00:00Z",
    ))

    # ========================================================================
    # 场景 3: 测试失败但没有明确的反模式
    # ========================================================================
    patterns.append(Pattern(
        type=PatternType.ANTI_PATTERN,
        description="异步函数要用 try-catch 包裹",
        occurrences=[
            PatternOccurrence(
                session_id="session-real-003",
                timestamp="2026-05-30T12:00:00Z",
                user_action="explicit_correction",
                context="src/api/fetchUser.ts",
                test_passed=True,
                user_input="加上 try-catch"
            ),
        ],
        first_seen="2026-05-30T12:00:00Z",
        last_seen="2026-05-30T12:00:00Z",
    ))

    # ========================================================================
    # 场景 4: 跨 2 个会话的重复修正（刚好达到阈值）
    # ========================================================================
    patterns.append(Pattern(
        type=PatternType.REPEATED_CORRECTION,
        description="useEffect 清理函数要返回，避免内存泄漏",
        occurrences=[
            PatternOccurrence(
                session_id="session-real-004a",
                timestamp="2026-05-20T10:00:00Z",
                user_action="explicit_correction",
                context="src/components/Timer.tsx",
                test_passed=True,
                user_input="useEffect 要返回清理函数"
            ),
            PatternOccurrence(
                session_id="session-real-004b",
                timestamp="2026-05-30T10:00:00Z",
                user_action="explicit_correction",
                context="src/components/Subscription.tsx",
                test_passed=True,
                user_input="记得清理 useEffect"
            ),
        ],
        first_seen="2026-05-20T10:00:00Z",
        last_seen="2026-05-30T10:00:00Z",
    ))

    # ========================================================================
    # 场景 5: 性能优化但没有明确的性能改善证据
    # ========================================================================
    patterns.append(Pattern(
        type=PatternType.PERFORMANCE,
        description="大列表要用虚拟滚动",
        occurrences=[
            PatternOccurrence(
                session_id="session-real-005",
                timestamp="2026-05-30T13:00:00Z",
                user_action="explicit_correction",
                context="src/components/LargeList.tsx",
                performance_improved=None,  # 没有性能测试
                user_input="列表太长了，用虚拟滚动"
            ),
        ],
        first_seen="2026-05-30T13:00:00Z",
        last_seen="2026-05-30T13:00:00Z",
    ))

    # ========================================================================
    # 场景 6: 安全问题但用户没有明确提到"安全"
    # ========================================================================
    patterns.append(Pattern(
        type=PatternType.SECURITY,
        description="用户输入要先验证再使用",
        occurrences=[
            PatternOccurrence(
                session_id="session-real-006",
                timestamp="2026-05-30T14:00:00Z",
                user_action="explicit_correction",
                context="src/api/createUser.ts",
                security_issue="input-validation",
                user_input="先验证一下输入"
            ),
        ],
        first_seen="2026-05-30T14:00:00Z",
        last_seen="2026-05-30T14:00:00Z",
    ))

    # ========================================================================
    # 场景 7: 多次出现但时间跨度很短（同一天）
    # ========================================================================
    patterns.append(Pattern(
        type=PatternType.REPEATED_CORRECTION,
        description="组件 props 要解构，不要用 props.xxx",
        occurrences=[
            PatternOccurrence(
                session_id="session-real-007",
                timestamp="2026-05-30T10:00:00Z",
                user_action="explicit_correction",
                context="src/components/Button.tsx",
                user_input="props 解构一下"
            ),
            PatternOccurrence(
                session_id="session-real-007",
                timestamp="2026-05-30T10:30:00Z",
                user_action="explicit_correction",
                context="src/components/Input.tsx",
                user_input="解构 props"
            ),
            PatternOccurrence(
                session_id="session-real-007",
                timestamp="2026-05-30T11:00:00Z",
                user_action="explicit_correction",
                context="src/components/Card.tsx",
                user_input="props 要解构"
            ),
        ],
        first_seen="2026-05-30T10:00:00Z",
        last_seen="2026-05-30T11:00:00Z",
    ))

    # ========================================================================
    # 场景 8: 偏好但有强烈的关键词
    # ========================================================================
    patterns.append(Pattern(
        type=PatternType.PREFERENCE,
        description="文件名用 kebab-case",
        occurrences=[
            PatternOccurrence(
                session_id="session-real-008",
                timestamp="2026-05-30T15:00:00Z",
                user_action="accept",
                context="src/components/",
                user_input="文件名改成 kebab-case，我们团队统一用这个"
            ),
        ],
        first_seen="2026-05-30T15:00:00Z",
        last_seen="2026-05-30T15:00:00Z",
    ))

    # ========================================================================
    # 场景 9: 反模式但测试没有失败（功能正常但不符合规范）
    # ========================================================================
    patterns.append(Pattern(
        type=PatternType.ANTI_PATTERN,
        description="不要在循环里调用 hooks",
        occurrences=[
            PatternOccurrence(
                session_id="session-real-009",
                timestamp="2026-05-30T16:00:00Z",
                user_action="explicit_correction",
                context="src/components/DynamicForm.tsx",
                test_passed=None,  # 没有运行测试
                user_input="hooks 不能在循环里调用"
            ),
        ],
        first_seen="2026-05-30T16:00:00Z",
        last_seen="2026-05-30T16:00:00Z",
    ))

    # ========================================================================
    # 场景 10: 性能优化且有明确的改善
    # ========================================================================
    patterns.append(Pattern(
        type=PatternType.PERFORMANCE,
        description="图片要懒加载",
        occurrences=[
            PatternOccurrence(
                session_id="session-real-010",
                timestamp="2026-05-30T17:00:00Z",
                user_action="explicit_correction",
                context="src/components/Gallery.tsx",
                performance_improved=True,
                user_input="图片太多了，加个懒加载，页面加载慢"
            ),
        ],
        first_seen="2026-05-30T17:00:00Z",
        last_seen="2026-05-30T17:00:00Z",
    ))

    return patterns


def main():
    """运行真实场景测试"""

    print("=" * 80)
    print("AutoImprove 原型 - 真实场景测试")
    print("=" * 80)
    print()

    patterns = create_realistic_test_patterns()

    results = {
        'generated': [],
        'rejected': []
    }

    for i, pattern in enumerate(patterns, 1):
        print(f"场景 {i}: {pattern.description}")
        print(f"类型: {pattern.type.value}")
        print(f"出现次数: {len(pattern.occurrences)}")

        # 显示会话信息
        unique_sessions = set(o.session_id for o in pattern.occurrences)
        print(f"会话数: {len(unique_sessions)}")

        # 计算置信度
        pattern.confidence = calculate_confidence(pattern)
        print(f"置信度: {pattern.confidence:.3f}")

        # 判断是否生成规则
        should_generate, reason = should_generate_rule(pattern)
        print(f"生成规则: {'✓ 是' if should_generate else '✗ 否'}")
        print(f"原因: {reason}")

        if should_generate:
            priority = determine_priority(pattern)
            pattern.priority = priority
            print(f"优先级: {priority}")

            if pattern.keywords:
                print(f"关键词: {', '.join(pattern.keywords)}")

            results['generated'].append(pattern)
        else:
            results['rejected'].append(pattern)

        print("-" * 80)
        print()

    # 总结
    print("=" * 80)
    print("测试总结")
    print("=" * 80)
    print(f"总场景数: {len(patterns)}")
    print(f"生成规则: {len(results['generated'])} 条")
    print(f"拒绝: {len(results['rejected'])} 条")
    print(f"成功率: {len(results['generated']) / len(patterns) * 100:.1f}%")
    print()

    # 详细分析被拒绝的场景
    if results['rejected']:
        print("被拒绝的场景分析:")
        for pattern in results['rejected']:
            print(f"  - {pattern.description}")
            print(f"    类型: {pattern.type.value}, 置信度: {pattern.confidence:.3f}")
            _, reason = should_generate_rule(pattern)
            print(f"    原因: {reason}")
        print()

    # 按优先级分组
    by_priority = {}
    for pattern in results['generated']:
        priority = pattern.priority or 'unknown'
        by_priority.setdefault(priority, []).append(pattern)

    print("生成的规则按优先级:")
    for priority in ['critical', 'high', 'medium', 'low']:
        patterns_list = by_priority.get(priority, [])
        if patterns_list:
            print(f"  {priority}: {len(patterns_list)} 条")
            for p in patterns_list:
                print(f"    - {p.description}")

    print()
    print("=" * 80)
    print("测试完成！")
    print("=" * 80)


if __name__ == "__main__":
    main()
