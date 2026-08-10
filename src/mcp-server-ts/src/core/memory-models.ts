import { Pattern, PatternType, Scene, createScene } from "./models.js";

export type MemoryKind = "semantic" | "episodic" | "procedural";
export type InfoClass = "preference" | "fact" | "experience";
export type MemoryStatus = "active" | "superseded" | "archived";
export type MemoryState = "candidate" | "observed" | "supported" | "validated" | "promoted" | "deprecated";
export type MemoryDecision = "ADD" | "UPDATE" | "SUPERSEDE" | "CONFLICT" | "NOOP";

export interface MemoryRuleLink {
  memory_id: string;
  rule_id: string;
  relation: "supports" | "derived_from" | "supersedes" | "contradicts";
  support_score: number;
  created_at: string;
  updated_at: string;
}

export interface MemoryNamespace {
  user_id?: string;
  organization_id?: string;
  project_path?: string;
  repository?: string;
  branch?: string;
  session_id?: string;
}

export interface MemoryEntity {
  id: string;
  name: string;
  type: "user" | "project" | "file" | "technology" | "tool" | "concept" | "unknown";
}

export interface MemoryRelation {
  subject: string;
  predicate: string;
  object: string;
  valid_from?: string;
  valid_to?: string;
}

export interface MemoryOutcome {
  status: "success" | "partial" | "failed" | "unknown";
  tests_passed?: boolean;
  user_confirmed?: boolean;
  files_changed?: string[];
  commands?: string[];
}

export type MemoryUsageEvent = "recalled" | "applied" | "accepted" | "corrected" | "rejected" | "validated" | "contradicted";

export interface MemoryEvidence {
  session_id: string;
  message_lines: number[];
  tool_names?: string[];
  source_excerpt?: string;
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  content: string;
  summary: string;
  pattern_type?: PatternType;
  scene: Scene;
  keywords: string[];
  evidence: MemoryEvidence[];
  confidence: number;
  importance: number;
  strength: number;
  created_at: string;
  updated_at: string;
  valid_from: string;
  valid_to?: string;
  status: MemoryStatus;
  state?: MemoryState;
  support_count?: number;
  independent_session_count?: number;
  independent_project_count?: number;
  validation_count?: number;
  contradiction_count?: number;
  last_validated_at?: string;
  supersedes?: string;
  metadata?: Record<string, unknown>;
  namespace?: MemoryNamespace;
  entities?: MemoryEntity[];
  relations?: MemoryRelation[];
  outcome?: MemoryOutcome;
  info_class?: InfoClass;            // 认知类别：偏好/事实/经验（决定能否成规则）
  sensitivity?: "public" | "sensitive";  // 关卡5
  ttl_days?: number;                // 关卡4
  expires_at?: string;              // 关卡4
  recall_count?: number;            // 关卡4
  last_recalled_at?: string;        // 关卡4
}

export interface MemoryMutation {
  decision: MemoryDecision;
  memory: MemoryRecord;
  previous_id?: string;
}

export interface MemorySearchResult {
  memory: MemoryRecord;
  score: number;
  reasons: string[];
}

export interface MemorySearchFilters {
  projectPath?: string;
  organizationId?: string;
  repository?: string;
  branch?: string;
  kind?: MemoryRecord["kind"];
}

export interface MemoryRepository {
  list(options?: { activeOnly?: boolean; kind?: MemoryRecord["kind"]; projectPath?: string; organizationId?: string; repository?: string; branch?: string }): MemoryRecord[];
  search(query: string, limit?: number, filters?: MemorySearchFilters): MemoryRecord[];
  searchScored?(query: string, limit?: number, filters?: MemorySearchFilters): MemorySearchResult[];
  apply(mutation: MemoryMutation): MemoryRecord;
  recordUsage?(memoryId: string, event: MemoryUsageEvent): void;
  linkRule?(link: MemoryRuleLink): void;
  getRulesForMemory?(memoryId: string): MemoryRuleLink[];
  getMemoriesForRule?(ruleId: string): MemoryRuleLink[];
  /** 审计日志：记忆版本变更历史（关卡指标·审计用）。存储不支持时返回空数组。 */
  getVersionHistory?(limit?: number): MemoryVersionEntry[];
  compact?(): void;
  close?(): void;
  /** 重新加载持久化记忆（JSONL 后端重读文件并刷新内存 Map；SQLite 后端为 no-op，因其每次查询都读实时数据）。可选，调用方用 `reload?.()` 安全调用。 */
  reload?(): void;
}

export interface MemoryVersionEntry {
  memory_id: string;
  versioned_at: string;
  decision: string;
  snapshot?: MemoryRecord;
}

export function createMemoryId(): string {
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function memoryFromPattern(
  pattern: Pattern,
  evidence: MemoryEvidence[],
  scene: Scene = createScene(),
  kind: MemoryKind = "procedural"
): MemoryRecord {
  const now = new Date().toISOString();
  const content = pattern.description.trim();
  return {
    id: createMemoryId(),
    kind,
    info_class: "experience",
    content,
    summary: content.slice(0, 240),
    pattern_type: pattern.type,
    scene,
    keywords: pattern.keywords || [],
    evidence,
    confidence: (typeof pattern.confidence === "number" && Number.isFinite(pattern.confidence)) ? pattern.confidence : 0.5,
    importance: pattern.priority === "critical" || pattern.priority === "high" ? 0.85 : 0.6,
    strength: Math.max(1, new Set(evidence.map(e => e.session_id)).size),
    created_at: now,
    updated_at: now,
    valid_from: pattern.first_seen || now,
    status: "active",
    state: "observed",
    support_count: 1,
    independent_session_count: new Set(evidence.map(e => e.session_id)).size,
    independent_project_count: pattern.project_paths?.length || 0,
    validation_count: 0,
    contradiction_count: 0,
    metadata: {
      occurrence_count: pattern.occurrences.length,
      project_paths: pattern.project_paths || [],
      source: "session_analyzer"
    },
    namespace: { session_id: evidence[0]?.session_id },
    entities: [],
    relations: []
  };
}

export function memoryFromOccurrence(
  pattern: Pattern,
  occurrence: Pattern["occurrences"][number],
  evidence: MemoryEvidence,
  scene: Scene = createScene()
): MemoryRecord {
  const now = new Date().toISOString();
  const content = occurrence.user_input?.trim() || pattern.description.trim();
  return {
    id: createMemoryId(),
    kind: "episodic",
    info_class: "experience",
    content,
    summary: content.slice(0, 240),
    pattern_type: pattern.type,
    scene,
    keywords: pattern.keywords || [],
    evidence: [evidence],
    confidence: (typeof pattern.confidence === "number" && Number.isFinite(pattern.confidence)) ? pattern.confidence : 0.5,
    importance: 0.65,
    strength: 1,
    created_at: now,
    updated_at: now,
    valid_from: occurrence.timestamp || now,
    status: "active",
    state: "candidate",
    support_count: 1,
    independent_session_count: 1,
    independent_project_count: pattern.project_paths?.length || 0,
    validation_count: 0,
    contradiction_count: 0,
    metadata: { source: "session_analyzer", action: occurrence.user_action, context: occurrence.context },
    namespace: { session_id: evidence.session_id },
    entities: [],
    relations: []
  };
}
