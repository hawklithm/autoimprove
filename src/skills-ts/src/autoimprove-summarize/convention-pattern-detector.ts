/**
 * Convention Pattern Detector
 *
 * Identifies "convention" or "standard" patterns that should be kept as independent rules
 * rather than being merged with other patterns during consolidation.
 */

export interface Pattern {
  type: string;
  description: string;
  confidence: number;
  keywords?: string[];
  occurrences?: any[];
}

/**
 * Detect if a pattern is a "convention" pattern.
 *
 * Convention patterns are organizational standards, naming conventions,
 * workflow rules, or project-specific guidelines that should remain
 * as standalone rules rather than being merged with error patterns.
 *
 * Examples:
 * - Git commit rules
 * - Code review standards
 * - Naming conventions
 * - API path prefixes
 * - Wrapper/abstraction requirements (e.g., DbClient)
 * - Transaction boundaries
 */
export function isConventionPattern(pattern: Pattern): boolean {
  const desc = pattern.description.toLowerCase();

  // Convention keywords - patterns containing these should stay independent
  const conventionKeywords = [
    // Version control & workflow
    'git', 'commit', '提交', 'push', 'pull request', 'pr',
    'branch', '分支', 'merge', '合并',

    // Code review
    'review', '审核', 'code review', '行号', 'line number',
    'comment', '评论',

    // Naming & organization
    'prefix', '前缀', 'suffix', '后缀', 'naming', '命名',
    'convention', '规范', 'standard', '标准',
    'format', '格式', 'pattern', '模式',

    // Abstraction & architecture
    'wrapper', '包装', 'abstraction', '抽象',
    'interface', '接口', 'adapter', '适配器',
    'dbclient', 'mapper包装', 'client封装',

    // Transaction & boundaries
    'transaction', '事务', 'boundary', '边界',
    '@transactional', 'commit', 'rollback',

    // File & project organization
    '不提交', 'do not commit', 'exclude', '排除',
    'file type', '文件类型', '.md', '.sql', '.sh',

    // API & endpoint standards
    'api path', 'endpoint', '接口路径', 'url pattern',
    'rest', 'restful', 'http method',

    // Class & package naming
    '全限定', 'fully qualified', 'package name', '包名',
    'import', '导入', 'class name', '类名'
  ];

  // Check if description contains any convention keywords
  for (const keyword of conventionKeywords) {
    if (desc.includes(keyword)) {
      return true;
    }
  }

  // Check pattern type - some types are inherently about conventions
  const conventionTypes = [
    'preference',  // User preferences are often project conventions
    'code-style'   // Code style is by definition a convention
  ];

  if (conventionTypes.includes(pattern.type)) {
    // Additional check: does it describe a "must" or "should" rule?
    const ruleIndicators = [
      '必须', 'must', 'should', '应该',
      '不能', 'cannot', 'must not', '禁止',
      '统一', 'uniform', 'consistent', '一致',
      '规定', 'require', 'mandate'
    ];

    for (const indicator of ruleIndicators) {
      if (desc.includes(indicator)) {
        return true;
      }
    }
  }

  // Check keywords field if available
  if (pattern.keywords && Array.isArray(pattern.keywords)) {
    const keywordStr = pattern.keywords.join(' ').toLowerCase();
    for (const keyword of conventionKeywords) {
      if (keywordStr.includes(keyword)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Separate patterns into convention vs. mergable patterns
 */
export function separateConventionPatterns(patterns: Pattern[]): {
  conventionPatterns: Pattern[];
  mergablePatterns: Pattern[];
} {
  const conventionPatterns: Pattern[] = [];
  const mergablePatterns: Pattern[] = [];

  for (const pattern of patterns) {
    if (isConventionPattern(pattern)) {
      conventionPatterns.push(pattern);
    } else {
      mergablePatterns.push(pattern);
    }
  }

  return { conventionPatterns, mergablePatterns };
}
