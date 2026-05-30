#!/usr/bin/env python3
"""
AutoImprove 最小原型 - 会话分析核心逻辑

这个原型实现了：
1. Pattern 检测（5 种类型）
2. 置信度计算（v2.0 公式）
3. 关键词检测
4. 规则生成判断

用于验证算法在构造数据上的效果。
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Set
from datetime import datetime
from enum import Enum


# ============================================================================
# 数据结构定义
# ============================================================================

class PatternType(Enum):
    REPEATED_CORRECTION = "repeated-correction"
    ANTI_PATTERN = "anti-pattern"
    PREFERENCE = "preference"
    PERFORMANCE = "performance"
    SECURITY = "security"


@dataclass
class Scene:
    tech: List[str] = field(default_factory=list)
    functional: List[str] = field(default_factory=list)
    business: List[str] = field(default_factory=list)


@dataclass
class PatternOccurrence:
    session_id: str
    timestamp: str
    user_action: str  # 'explicit_correction', 'amend', 'undo', 'accept'
    context: str
    test_passed: Optional[bool] = None
    performance_improved: Optional[bool] = None
    security_issue: Optional[str] = None
    user_input: Optional[str] = None


@dataclass
class Pattern:
    type: PatternType
    description: str
    occurrences: List[PatternOccurrence]
    first_seen: str
    last_seen: str
    confidence: float = 0.0
    category: Optional[str] = None
    priority: Optional[str] = None
    keywords: List[str] = field(default_factory=list)


@dataclass
class Rule:
    id: str
    content: str
    reason: str
    scenes: Scene
    source: str  # 'learned' or 'manual'
    confidence: float
    type: PatternType
    category: Optional[str] = None
    priority: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""


# ============================================================================
# 框架规则识别 🆕 改进 2
# ============================================================================

FRAMEWORK_RULES = {
    'react': [
        'hooks', 'useEffect', 'useState', 'useCallback', 'useMemo',
        'Rules of Hooks', '循环里调用', '条件里调用'
    ],
    'vue': ['reactive', 'ref', 'computed', 'watch'],
    'angular': ['ngOnInit', 'ngOnDestroy', 'ChangeDetection'],
}


def is_framework_rule(pattern: Pattern) -> bool:
    """检查是否是框架特定规则"""
    description_lower = pattern.description.lower()

    for framework, keywords in FRAMEWORK_RULES.items():
        if any(kw.lower() in description_lower for kw in keywords):
            return True

    # 也检查用户输入
    for occurrence in pattern.occurrences:
        if occurrence.user_input:
            input_lower = occurrence.user_input.lower()
            for framework, keywords in FRAMEWORK_RULES.items():
                if any(kw.lower() in input_lower for kw in keywords):
                    return True

    return False


# ============================================================================
# 分类策略配置
# ============================================================================

PATTERN_STRATEGIES = {
    PatternType.REPEATED_CORRECTION: {
        'min_confidence': 0.45,              # 🆕 改进 3: 从 0.5 降到 0.45
        'min_occurrences': 2,
        'requires_multiple_sessions': True,
        'weight_adjustment': 1.0,
        'detect_keywords': [],
    },
    PatternType.ANTI_PATTERN: {
        'min_confidence': 0.45,              # 🆕 改进 3: 从 0.5 降到 0.45
        'min_occurrences': 1,
        'requires_test_validation': True,
        'weight_adjustment': 1.0,
        'detect_keywords': [],
    },
    PatternType.PREFERENCE: {
        'min_confidence': 0.3,
        'min_occurrences': 1,
        'requires_multiple_sessions': False,
        'weight_adjustment': 1.0,
        'detect_keywords': [
            '我们团队', '团队习惯', '我更喜欢', '我们约定',
            'we prefer', 'our team', 'we use', 'convention'
        ],
    },
    PatternType.PERFORMANCE: {
        'min_confidence': 0.4,
        'min_occurrences': 1,
        'requires_performance_evidence': True,
        'weight_adjustment': 1.0,
        'detect_keywords': [
            'useMemo', 'useCallback', 'React.memo',
            '重渲染', '性能', 'optimize', 'performance',
            'slow', 'lag', '卡顿'
        ],
    },
    PatternType.SECURITY: {
        'min_confidence': 0.3,
        'min_occurrences': 1,
        'requires_multiple_sessions': False,
        'weight_adjustment': 1.5,
        'priority': 'high',
        'detect_keywords': [
            'sql injection', 'xss', 'csrf', 'injection',
            '注入', '安全', 'security', 'vulnerability',
            'sanitize', 'escape', 'validate', 'attack'
        ],
    },
}


# ============================================================================
# 置信度计算
# ============================================================================

def calculate_confidence(pattern: Pattern) -> float:
    """计算 Pattern 的置信度（v2.0 公式）"""

    # 步骤 1: 计算基础置信度
    base_confidence = calculate_base_confidence(pattern)

    # 步骤 2: 应用类型特定的调整
    adjusted_confidence = apply_type_adjustments(pattern, base_confidence)

    # 步骤 3: 应用关键词加成
    final_confidence = apply_keyword_bonus(pattern, adjusted_confidence)

    return min(final_confidence, 1.0)


def calculate_base_confidence(pattern: Pattern) -> float:
    """计算基础置信度"""

    # 因素 1: 频率得分（改进：同一会话多次出现加成）
    frequency_score = calculate_frequency_score(pattern)

    # 因素 2: 时间跨度得分
    time_span_score = calculate_time_span_score(pattern)

    # 因素 3: 用户行为得分
    behavior_score = calculate_behavior_score(pattern)

    # 因素 4: 验证结果得分
    validation_score = calculate_validation_score(pattern)

    # v2.0 权重分配
    confidence = (
        frequency_score * 0.3 +
        time_span_score * 0.1 +
        behavior_score * 0.4 +
        validation_score * 0.2
    )

    return confidence


def calculate_frequency_score(pattern: Pattern) -> float:
    """计算频率得分（改进版：同一会话多次出现加成）"""
    # 基础频率得分
    base_score = min(len(pattern.occurrences) / 10, 1.0)

    # 🆕 改进 1: 同一会话 3+ 次出现，给予加成
    unique_sessions = set(o.session_id for o in pattern.occurrences)
    if len(unique_sessions) == 1 and len(pattern.occurrences) >= 3:
        base_score += 0.1  # 加成 0.1

    return min(base_score, 1.0)


def calculate_time_span_score(pattern: Pattern) -> float:
    """计算时间跨度得分"""
    try:
        first = datetime.fromisoformat(pattern.first_seen.replace('Z', '+00:00'))
        last = datetime.fromisoformat(pattern.last_seen.replace('Z', '+00:00'))
        days = (last - first).days
        return min(days / 90, 1.0)
    except:
        return 0.0


def calculate_behavior_score(pattern: Pattern) -> float:
    """计算用户行为得分"""

    # 对于偏好类型，'accept' 也算作有效行为
    if pattern.type == PatternType.PREFERENCE:
        valid_actions = sum(
            1 for o in pattern.occurrences
            if o.user_action in ['explicit_correction', 'accept']
        )
    else:
        valid_actions = sum(
            1 for o in pattern.occurrences
            if o.user_action == 'explicit_correction'
        )

    if len(pattern.occurrences) == 0:
        return 0.0

    return valid_actions / len(pattern.occurrences)


def calculate_validation_score(pattern: Pattern) -> float:
    """计算验证结果得分"""
    score = 0
    count = 0

    for occurrence in pattern.occurrences:
        # 测试通过
        if occurrence.test_passed is True:
            score += 1.0
            count += 1

        # 性能改善
        if occurrence.performance_improved is True:
            score += 1.0
            count += 1

        # 安全问题修复
        if occurrence.security_issue:
            score += 1.0
            count += 1

    return score / count if count > 0 else 0.0


def apply_type_adjustments(pattern: Pattern, base_confidence: float) -> float:
    """应用类型特定的权重调整"""
    strategy = PATTERN_STRATEGIES[pattern.type]
    return base_confidence * strategy['weight_adjustment']


def apply_keyword_bonus(pattern: Pattern, confidence: float) -> float:
    """应用关键词加成"""
    strategy = PATTERN_STRATEGIES[pattern.type]
    keywords = strategy.get('detect_keywords', [])

    if not keywords:
        return confidence

    # 检查是否有关键词（在描述或用户输入中）
    found_keywords = []

    # 检查描述
    for keyword in keywords:
        if keyword.lower() in pattern.description.lower():
            found_keywords.append(keyword)

    # 检查用户输入
    for occurrence in pattern.occurrences:
        if occurrence.user_input:
            for keyword in keywords:
                if keyword.lower() in occurrence.user_input.lower():
                    if keyword not in found_keywords:
                        found_keywords.append(keyword)

    # 关键词加成
    if found_keywords:
        pattern.keywords = found_keywords
        return confidence + 0.2

    return confidence


# ============================================================================
# 规则生成判断
# ============================================================================

def should_generate_rule(pattern: Pattern) -> tuple[bool, str]:
    """判断是否应该生成规则"""
    strategy = PATTERN_STRATEGIES[pattern.type]

    # 🆕 改进 2: 框架规则优先检查（在置信度检查之前）
    if pattern.type == PatternType.ANTI_PATTERN:
        if is_framework_rule(pattern):
            # 框架规则不需要测试验证，也降低置信度要求
            if pattern.confidence >= 0.3:  # 更低的阈值
                return True, "框架特定规则"

    # 检查置信度
    if pattern.confidence < strategy['min_confidence']:
        return False, f"置信度不足 ({pattern.confidence:.2f} < {strategy['min_confidence']})"

    # 检查出现次数
    if len(pattern.occurrences) < strategy['min_occurrences']:
        return False, f"出现次数不足 ({len(pattern.occurrences)} < {strategy['min_occurrences']})"

    # 检查是否需要跨会话
    if strategy.get('requires_multiple_sessions', False):
        unique_sessions = set(o.session_id for o in pattern.occurrences)
        if len(unique_sessions) < 2:
            return False, f"需要跨会话出现 (当前只有 {len(unique_sessions)} 个会话)"

    # 检查是否需要测试验证
    if strategy.get('requires_test_validation', False):
        has_test = any(o.test_passed is True for o in pattern.occurrences)
        if not has_test:
            return False, "需要测试验证"

    # 检查是否需要性能证据
    if strategy.get('requires_performance_evidence', False):
        has_perf = any(o.performance_improved is True for o in pattern.occurrences)
        if not has_perf:
            return False, "需要性能改善证据"

    return True, "满足所有条件"


def determine_priority(pattern: Pattern) -> str:
    """确定规则优先级"""
    if pattern.type == PatternType.SECURITY:
        return 'critical'

    base_priority = {
        PatternType.ANTI_PATTERN: 'high',
        PatternType.PERFORMANCE: 'medium',
        PatternType.REPEATED_CORRECTION: 'medium',
        PatternType.PREFERENCE: 'low',
    }.get(pattern.type, 'medium')

    # 高置信度提升一级
    if pattern.confidence >= 0.9:
        if base_priority == 'medium':
            return 'high'
        if base_priority == 'low':
            return 'medium'

    return base_priority


# ============================================================================
# 测试数据
# ============================================================================

def create_test_patterns() -> List[Pattern]:
    """创建测试 Pattern 数据"""

    patterns = []

    # Pattern 1: JWT token 刷新（重复修正，跨 3 个会话）
    patterns.append(Pattern(
        type=PatternType.REPEATED_CORRECTION,
        description="JWT token 刷新必须使用 refreshToken() 辅助函数",
        occurrences=[
            PatternOccurrence(
                session_id="session-001",
                timestamp="2026-05-01T10:00:00Z",
                user_action="explicit_correction",
                context="src/components/Auth/LoginForm.tsx",
                test_passed=True,
                user_input="改用 refreshToken() 函数"
            ),
            PatternOccurrence(
                session_id="session-002",
                timestamp="2026-05-15T14:00:00Z",
                user_action="explicit_correction",
                context="src/pages/Profile.tsx",
                test_passed=True,
                user_input="token 刷新要用 refreshToken()"
            ),
            PatternOccurrence(
                session_id="session-003",
                timestamp="2026-05-30T16:00:00Z",
                user_action="explicit_correction",
                context="src/services/authService.ts",
                test_passed=True,
                user_input="不要内联 JWT decode，用 refreshToken()"
            ),
        ],
        first_seen="2026-05-01T10:00:00Z",
        last_seen="2026-05-30T16:00:00Z",
    ))

    # Pattern 2: Repository 层（反模式）
    patterns.append(Pattern(
        type=PatternType.ANTI_PATTERN,
        description="API 调用要通过 repository 层，不要直接使用 Prisma",
        occurrences=[
            PatternOccurrence(
                session_id="session-004",
                timestamp="2026-05-30T10:00:00Z",
                user_action="explicit_correction",
                context="src/services/userService.ts",
                test_passed=True,
                user_input="不要直接用 Prisma，要通过 UserRepository"
            ),
        ],
        first_seen="2026-05-30T10:00:00Z",
        last_seen="2026-05-30T10:00:00Z",
    ))

    # Pattern 3: Named exports（用户偏好）
    patterns.append(Pattern(
        type=PatternType.PREFERENCE,
        description="优先使用 named exports 而非 default exports",
        occurrences=[
            PatternOccurrence(
                session_id="session-005",
                timestamp="2026-05-30T14:00:00Z",
                user_action="accept",
                context="src/components/UserProfile.tsx",
                user_input="改成 named export，我们团队不用 default export"
            ),
        ],
        first_seen="2026-05-30T14:00:00Z",
        last_seen="2026-05-30T14:00:00Z",
    ))

    # Pattern 4: useMemo 优化（性能优化）
    patterns.append(Pattern(
        type=PatternType.PERFORMANCE,
        description="列表渲染要用 useMemo 优化，避免不必要的重渲染",
        occurrences=[
            PatternOccurrence(
                session_id="session-006",
                timestamp="2026-05-30T15:00:00Z",
                user_action="explicit_correction",
                context="src/components/UserList.tsx",
                performance_improved=True,
                user_input="users.map 会导致大量重渲染，用 useMemo 优化一下"
            ),
        ],
        first_seen="2026-05-30T15:00:00Z",
        last_seen="2026-05-30T15:00:00Z",
    ))

    # Pattern 5: SQL 参数化（安全问题）
    patterns.append(Pattern(
        type=PatternType.SECURITY,
        description="不要直接拼接 SQL，必须使用参数化查询防止 SQL 注入",
        occurrences=[
            PatternOccurrence(
                session_id="session-007",
                timestamp="2026-05-30T16:00:00Z",
                user_action="explicit_correction",
                context="src/services/userService.ts:getUserByEmail",
                security_issue="sql-injection",
                user_input="不要直接拼接 SQL，这会导致 SQL 注入！用参数化查询"
            ),
        ],
        first_seen="2026-05-30T16:00:00Z",
        last_seen="2026-05-30T16:00:00Z",
    ))

    return patterns


# ============================================================================
# 主程序
# ============================================================================

def main():
    """运行原型测试"""

    print("=" * 80)
    print("AutoImprove 最小原型 - 会话分析测试")
    print("=" * 80)
    print()

    # 创建测试数据
    patterns = create_test_patterns()

    # 分析每个 Pattern
    results = []

    for i, pattern in enumerate(patterns, 1):
        print(f"Pattern {i}: {pattern.description}")
        print(f"类型: {pattern.type.value}")
        print(f"出现次数: {len(pattern.occurrences)}")

        # 计算置信度
        pattern.confidence = calculate_confidence(pattern)
        print(f"置信度: {pattern.confidence:.3f}")

        # 判断是否生成规则
        should_generate, reason = should_generate_rule(pattern)
        print(f"生成规则: {'✓ 是' if should_generate else '✗ 否'}")
        print(f"原因: {reason}")

        if should_generate:
            # 确定优先级
            priority = determine_priority(pattern)
            pattern.priority = priority
            print(f"优先级: {priority}")

            # 显示检测到的关键词
            if pattern.keywords:
                print(f"关键词: {', '.join(pattern.keywords)}")

            results.append(pattern)

        print("-" * 80)
        print()

    # 总结
    print("=" * 80)
    print("测试总结")
    print("=" * 80)
    print(f"总 Pattern 数: {len(patterns)}")
    print(f"可生成规则数: {len(results)}")
    print(f"成功率: {len(results) / len(patterns) * 100:.1f}%")
    print()

    # 按优先级分组
    by_priority = {}
    for pattern in results:
        priority = pattern.priority or 'unknown'
        by_priority.setdefault(priority, []).append(pattern)

    print("按优先级分组:")
    for priority in ['critical', 'high', 'medium', 'low']:
        count = len(by_priority.get(priority, []))
        if count > 0:
            print(f"  {priority}: {count} 条规则")

    print()

    # 按类型分组
    by_type = {}
    for pattern in results:
        type_name = pattern.type.value
        by_type.setdefault(type_name, []).append(pattern)

    print("按类型分组:")
    for type_name, patterns_list in by_type.items():
        print(f"  {type_name}: {len(patterns_list)} 条规则")

    print()
    print("=" * 80)
    print("测试完成！")
    print("=" * 80)


if __name__ == "__main__":
    main()
