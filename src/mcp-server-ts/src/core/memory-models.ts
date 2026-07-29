import { Pattern, PatternType, Scene, createScene } from "./models.js";

export type MemoryKind = "semantic" | "episodic" | "procedural";
export type MemoryStatus = "active" | "superseded" | "archived";
export type MemoryDecision = "ADD" | "UPDATE" | "SUPERSEDE" | "NOOP";

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
  supersedes?: string;
  metadata?: Record<string, unknown>;
  namespace?: MemoryNamespace;
  entities?: MemoryEntity[];
  relations?: MemoryRelation[];
  outcome?: MemoryOutcome;
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

export interface MemoryRepository {
  list(options?: { activeOnly?: boolean; kind?: MemoryRecord["kind"]; projectPath?: string }): MemoryRecord[];
  search(query: string, limit?: number, filters?: { projectPath?: string; kind?: MemoryRecord["kind"] }): MemoryRecord[];
  searchScored?(query: string, limit?: number, filters?: { projectPath?: string; kind?: MemoryRecord["kind"] }): MemorySearchResult[];
  apply(mutation: MemoryMutation): MemoryRecord;
  recordUsage?(memoryId: string, event: MemoryUsageEvent): void;
  compact?(): void;
  close?(): void;
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
    content,
    summary: content.slice(0, 240),
    pattern_type: pattern.type,
    scene,
    keywords: pattern.keywords || [],
    evidence,
    confidence: pattern.confidence,
    importance: pattern.priority === "critical" || pattern.priority === "high" ? 0.85 : 0.6,
    strength: Math.max(1, new Set(evidence.map(e => e.session_id)).size),
    created_at: now,
    updated_at: now,
    valid_from: pattern.first_seen || now,
    status: "active",
    metadata: {
      occurrence_count: pattern.occurrences.length,
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
    content,
    summary: content.slice(0, 240),
    pattern_type: pattern.type,
    scene,
    keywords: pattern.keywords || [],
    evidence: [evidence],
    confidence: pattern.confidence,
    importance: 0.65,
    strength: 1,
    created_at: now,
    updated_at: now,
    valid_from: occurrence.timestamp || now,
    status: "active",
    metadata: { source: "session_analyzer", action: occurrence.user_action, context: occurrence.context },
    namespace: { session_id: evidence.session_id },
    entities: [],
    relations: []
  };
}
