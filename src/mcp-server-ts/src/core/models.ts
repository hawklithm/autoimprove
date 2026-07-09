/**
 * Core data structures for AutoImprove pattern detection.
 *
 * TypeScript port from Python core/models.py
 */

// ============================================================================
// Enums
// ============================================================================

export enum PatternType {
  REPEATED_CORRECTION = "repeated-correction",
  ANTI_PATTERN = "anti-pattern",
  PREFERENCE = "preference",
  PERFORMANCE = "performance",
  SECURITY = "security"
}

export enum Priority {
  CRITICAL = "critical",
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low"
}

export enum RuleScope {
  GLOBAL = "global",           // Universal programming patterns/principles
  ORGANIZATION = "organization", // Company-specific frameworks/conventions
  PROJECT = "project"          // Project-specific implementations
}

// ============================================================================
// Scene Model
// ============================================================================

export interface Scene {
  tech: string[];
  functional: string[];
  business: string[];
}

export function createScene(partial: Partial<Scene> = {}): Scene {
  return {
    tech: Array.isArray(partial.tech) ? partial.tech : [],
    functional: Array.isArray(partial.functional) ? partial.functional : [],
    business: Array.isArray(partial.business) ? partial.business : []
  };
}

// ============================================================================
// Pattern Detection Models
// ============================================================================

export interface PatternOccurrence {
  session_id: string;
  timestamp: string;
  user_action: "explicit_correction" | "amend" | "undo" | "accept";
  context: string;

  // Quality validation fields (currently not fully implemented)
  // TODO: Implement test output parsing to set test_passed from actual test runs
  test_passed?: boolean;  // Would indicate fix passed tests (requires test output parsing)

  // Currently hardcoded to true for performance patterns (not based on actual benchmarks)
  // TODO: Implement performance metric parsing from benchmark/profiler output
  performance_improved?: boolean;  // Would indicate actual performance improvement

  security_issue?: string;
  user_input?: string;
}

export interface Pattern {
  type: PatternType;
  description: string;
  occurrences: PatternOccurrence[];
  first_seen: string;
  last_seen: string;
  confidence: number;
  category?: string;
  priority?: Priority;
  keywords: string[];
}

// ============================================================================
// Rule Storage Models
// ============================================================================

export interface RuleIndexEntry {
  id: string;
  type: PatternType;
  priority: Priority;
  confidence: number;
  scenes: Scene;
  keywords: string[];
  created_at: string;
  updated_at: string;
  scope?: RuleScope;           // Rule applicability scope
  scope_context?: {            // Additional scope metadata
    organization_id?: string;  // e.g., company domain, org identifier
    project_id?: string;       // e.g., project name, repo path
    project_path?: string;     // Absolute path of project where rule was learned
  };
}

export interface RuleIndex {
  version: string;
  rules: RuleIndexEntry[];
}

export interface CodeExample {
  bad?: string;
  good: string;
  explanation: string;
  language?: string;
}

export interface RuleContent {
  id: string;
  content: string; // Backward compatibility: full formatted content

  // Structured content (Phase 4)
  title?: string;
  description?: string;
  reason: string;
  how_to_apply?: string[];
  examples?: CodeExample[];
  when_to_use?: string[];
  exceptions?: string[];
  related_rules?: string[];

  metadata: {
    type?: string;
    priority?: string;
    confidence?: number;
    source?: string;
    pattern_occurrences?: number;
    first_seen?: string;
    last_seen?: string;
    keywords?: string[];
    quality_score?: number;
    scope_confidence?: number;  // LLM's confidence in scope determination (0.0-1.0)
    scope_reason?: string;      // LLM's explanation for scope choice
    [key: string]: any;
  };
}

export interface RuleMatch {
  rule: RuleIndexEntry;
  relevance_score: number;
  match_reason: string;
}

// ============================================================================
// Session Archive
// ============================================================================

export interface SessionArchive {
  session_id: string;
  created_at: string;
  patterns_count: number;
  rules_generated: string[];
  scene?: Scene;
  metadata?: Record<string, any>;
}

// ============================================================================
// Framework Detection
// ============================================================================

const FRAMEWORK_RULES: Record<string, string[]> = {
  react: [
    "hooks",
    "useEffect",
    "useState",
    "useCallback",
    "useMemo",
    "Rules of Hooks",
    "循环里调用",
    "条件里调用"
  ],
  vue: ["reactive", "ref", "computed", "watch"],
  angular: ["ngOnInit", "ngOnDestroy", "ChangeDetection"]
};

export function isFrameworkRule(pattern: Pattern): boolean {
  const descriptionLower = pattern.description.toLowerCase();

  // Check description
  for (const keywords of Object.values(FRAMEWORK_RULES)) {
    if (keywords.some(kw => descriptionLower.includes(kw.toLowerCase()))) {
      return true;
    }
  }

  // Check user input in occurrences
  for (const occurrence of pattern.occurrences) {
    if (occurrence.user_input) {
      const inputLower = occurrence.user_input.toLowerCase();
      for (const keywords of Object.values(FRAMEWORK_RULES)) {
        if (keywords.some(kw => inputLower.includes(kw.toLowerCase()))) {
          return true;
        }
      }
    }
  }

  return false;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isPatternType(value: string): value is PatternType {
  return Object.values(PatternType).includes(value as PatternType);
}

export function isPriority(value: string): value is Priority {
  return Object.values(Priority).includes(value as Priority);
}

export function isRuleScope(value: string): value is RuleScope {
  return Object.values(RuleScope).includes(value as RuleScope);
}

// ============================================================================
// Helpers
// ============================================================================

export function createRuleIndex(): RuleIndex {
  return {
    version: "1.0",
    rules: []
  };
}

export function createPattern(partial: Partial<Pattern> & Pick<Pattern, 'type' | 'description' | 'occurrences' | 'first_seen' | 'last_seen'>): Pattern {
  return {
    confidence: 0,
    keywords: [],
    ...partial
  };
}
