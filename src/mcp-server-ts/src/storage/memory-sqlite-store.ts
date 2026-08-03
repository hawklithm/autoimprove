import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { MemoryMutation, MemoryRecord, MemoryRepository, MemorySearchResult, MemoryUsageEvent, MemoryRuleLink, MemoryState, MemorySearchFilters } from "../core/memory-models.js";
import { STORAGE_ROOT } from "./init.js";
import { MemoryStore } from "./memory-store.js";

function charSimilarity(a: string, b: string): number {
  const grams = (value: string) => {
    const normalized = value.toLowerCase().replace(/\s+/g, "");
    const result = new Set<string>();
    for (let i = 0; i < normalized.length - 1; i++) result.add(normalized.slice(i, i + 2));
    return result;
  };
  const left = grams(a); const right = grams(b);
  if (!left.size || !right.size) return 0;
  return [...left].filter(item => right.has(item)).length / new Set([...left, ...right]).size;
}

export class SQLiteMemoryStore implements MemoryRepository {
  private readonly db: Database.Database;

  constructor(dbPath = join(STORAGE_ROOT, "memories", "memory.sqlite")) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "memory-storage-schema.sql");
    const candidates = [schemaPath, join(process.cwd(), "src", "storage", "memory-storage-schema.sql")];
    const resolved = candidates.find(path => existsSync(path));
    if (!resolved) throw new Error("memory-storage-schema.sql not found");
    this.db.exec(readFileSync(resolved, "utf8"));
    this.ensureMemoryColumns();
  }

  private ensureMemoryColumns(): void {
    const existing = new Set((this.db.prepare("PRAGMA table_info(memories)").all() as Array<{ name: string }>).map(column => column.name));
    const columns: Record<string, string> = {
      state: "TEXT NOT NULL DEFAULT 'candidate'",
      support_count: "INTEGER NOT NULL DEFAULT 1",
      independent_session_count: "INTEGER NOT NULL DEFAULT 1",
      independent_project_count: "INTEGER NOT NULL DEFAULT 0",
      validation_count: "INTEGER NOT NULL DEFAULT 0",
      contradiction_count: "INTEGER NOT NULL DEFAULT 0",
      last_validated_at: "TEXT"
    };
    for (const [name, type] of Object.entries(columns)) {
      if (!existing.has(name)) this.db.exec(`ALTER TABLE memories ADD COLUMN ${name} ${type}`);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_rule_links (
      memory_id TEXT NOT NULL, rule_id TEXT NOT NULL, relation TEXT NOT NULL,
      support_score REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(memory_id, rule_id), FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    )`);
  }

  list(options: { activeOnly?: boolean; kind?: MemoryRecord["kind"]; projectPath?: string; organizationId?: string; repository?: string; branch?: string } = {}): MemoryRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.activeOnly) clauses.push("status = 'active'");
    if (options.kind) { clauses.push("kind = ?"); params.push(options.kind); }
    const rows = this.db.prepare(`SELECT * FROM memories ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC`).all(...params) as any[];
    return rows.map(row => this.deserialize(row)).filter(record =>
      (!options.projectPath || !record.namespace?.project_path || record.namespace.project_path === options.projectPath) &&
      (!options.organizationId || !record.namespace?.organization_id || record.namespace.organization_id.toLowerCase() === options.organizationId.toLowerCase())
      && (!options.repository || !record.namespace?.repository || record.namespace.repository === options.repository)
      && (!options.branch || !record.namespace?.branch || record.namespace.branch === options.branch)
    );
  }

  search(query: string, limit = 8, filters: MemorySearchFilters = {}): MemoryRecord[] {
    return this.searchScored(query, limit, filters).map(result => result.memory);
  }

  searchScored(query: string, limit = 8, filters: MemorySearchFilters = {}): MemorySearchResult[] {
    const tokens = query.toLowerCase().split(/[^\p{L}\p{N}_+#.-]+/u).filter(Boolean);
    if (tokens.length === 0) return [];
    const like = tokens.map(() => "(content LIKE ? OR summary LIKE ? OR keywords_json LIKE ? OR namespace_json LIKE ?)").join(" OR ");
    const params = tokens.flatMap(token => [`%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`]);
    const rows = this.db.prepare(`SELECT * FROM memories WHERE status = 'active' AND (${like}) ORDER BY updated_at DESC LIMIT ?`).all(...params, Math.max(limit * 5, 20)) as any[];
    return rows.map(row => this.deserialize(row)).filter(memory =>
      (!filters.kind || memory.kind === filters.kind) &&
      (!filters.projectPath || !memory.namespace?.project_path || memory.namespace.project_path === filters.projectPath) &&
      (!filters.organizationId || !memory.namespace?.organization_id || memory.namespace.organization_id.toLowerCase() === filters.organizationId.toLowerCase()) &&
      (!filters.repository || !memory.namespace?.repository || memory.namespace.repository === filters.repository) &&
      (!filters.branch || !memory.namespace?.branch || memory.namespace.branch === filters.branch)
    ).map(memory => {
      const haystack = `${memory.content} ${memory.summary} ${memory.keywords.join(" ")}`.toLowerCase();
      const matched = tokens.filter(token => haystack.includes(token)).length;
      const lexical = matched / Math.max(1, tokens.length);
      const semantic = charSimilarity(query, `${memory.content} ${memory.summary}`);
      const validationBoost = Math.min(1, (memory.validation_count || 0) / 3);
      const contradictionPenalty = Math.min(1, (memory.contradiction_count || 0) / 2);
      const score = semantic * 0.22 + lexical * 0.32 + memory.importance * 0.12 + memory.confidence * 0.12 + Math.min(1, memory.strength / 5) * 0.08 + validationBoost * 0.06 + (memory.outcome?.status === "success" ? 0.08 : 0.0) - contradictionPenalty * 0.12;
      return { memory, score, reasons: [`sqlite-keyword:${lexical.toFixed(2)}`, `char-semantic:${semantic.toFixed(2)}`] };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  apply(mutation: MemoryMutation): MemoryRecord {
    const record = mutation.memory;
    const tx = this.db.transaction(() => {
      if (mutation.previous_id && mutation.decision === "SUPERSEDE") {
        this.db.prepare("UPDATE memories SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ?").run(record.valid_from, record.updated_at, mutation.previous_id);
      }
      this.db.prepare(`INSERT INTO memories (id, kind, content, summary, pattern_type, scene_json, keywords_json, evidence_json, confidence, importance, strength, created_at, updated_at, valid_from, valid_to, status, state, support_count, independent_session_count, independent_project_count, validation_count, contradiction_count, last_validated_at, supersedes, namespace_json, outcome_json, metadata_json)
        VALUES (@id,@kind,@content,@summary,@pattern_type,@scene_json,@keywords_json,@evidence_json,@confidence,@importance,@strength,@created_at,@updated_at,@valid_from,@valid_to,@status,@state,@support_count,@independent_session_count,@independent_project_count,@validation_count,@contradiction_count,@last_validated_at,@supersedes,@namespace_json,@outcome_json,@metadata_json)
        ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, content=excluded.content, summary=excluded.summary, pattern_type=excluded.pattern_type, scene_json=excluded.scene_json, keywords_json=excluded.keywords_json, evidence_json=excluded.evidence_json, confidence=excluded.confidence, importance=excluded.importance, strength=excluded.strength, updated_at=excluded.updated_at, valid_to=excluded.valid_to, status=excluded.status, state=excluded.state, support_count=excluded.support_count, independent_session_count=excluded.independent_session_count, independent_project_count=excluded.independent_project_count, validation_count=excluded.validation_count, contradiction_count=excluded.contradiction_count, last_validated_at=excluded.last_validated_at, supersedes=excluded.supersedes, namespace_json=excluded.namespace_json, outcome_json=excluded.outcome_json, metadata_json=excluded.metadata_json`).run(this.serialize(record));
      this.db.prepare("INSERT INTO memory_versions (memory_id, versioned_at, decision, snapshot_json) VALUES (?, ?, ?, ?)").run(record.id, record.updated_at, mutation.decision, JSON.stringify(record));
      this.db.prepare("DELETE FROM memory_entities WHERE memory_id = ?").run(record.id);
      for (const entity of record.entities || []) this.db.prepare("INSERT OR REPLACE INTO memory_entities (memory_id, entity_id, name, type) VALUES (?, ?, ?, ?)").run(record.id, entity.id, entity.name, entity.type);
      this.db.prepare("DELETE FROM memory_relations WHERE memory_id = ?").run(record.id);
      for (const relation of record.relations || []) this.db.prepare("INSERT OR REPLACE INTO memory_relations (memory_id, subject, predicate, object, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?)").run(record.id, relation.subject, relation.predicate, relation.object, relation.valid_from, relation.valid_to);
    });
    tx();
    return record;
  }

  recordUsage(memoryId: string, event: MemoryUsageEvent): void {
    const delta = ["rejected", "corrected", "contradicted"].includes(event) ? -0.5 : 0.5;
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO memory_usage (memory_id, event, occurred_at) VALUES (?, ?, ?)").run(memoryId, event, new Date().toISOString());
      const now = new Date().toISOString();
      this.db.prepare("UPDATE memories SET strength = MAX(0, strength + ?), validation_count = validation_count + ?, contradiction_count = contradiction_count + ?, last_validated_at = CASE WHEN ? = 1 THEN ? ELSE last_validated_at END, state = CASE WHEN ? = 1 AND state IN ('candidate','observed','supported') THEN 'validated' WHEN ? = 1 THEN 'deprecated' ELSE state END, updated_at = ? WHERE id = ?")
        .run(delta, event === "validated" || event === "accepted" ? 1 : 0, event === "contradicted" || event === "corrected" ? 1 : 0, event === "validated" || event === "accepted" ? 1 : 0, now, event === "validated" || event === "accepted" ? 1 : 0, event === "contradicted" || event === "corrected" ? 1 : 0, now, memoryId);
    })();
  }

  linkRule(link: MemoryRuleLink): void {
    this.db.prepare(`INSERT INTO memory_rule_links (memory_id, rule_id, relation, support_score, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, rule_id) DO UPDATE SET relation=excluded.relation, support_score=excluded.support_score, updated_at=excluded.updated_at`)
      .run(link.memory_id, link.rule_id, link.relation, link.support_score, link.created_at, link.updated_at);
  }

  getRulesForMemory(memoryId: string): MemoryRuleLink[] {
    return this.db.prepare("SELECT memory_id, rule_id, relation, support_score, created_at, updated_at FROM memory_rule_links WHERE memory_id = ?").all(memoryId) as MemoryRuleLink[];
  }

  getMemoriesForRule(ruleId: string): MemoryRuleLink[] {
    return this.db.prepare("SELECT memory_id, rule_id, relation, support_score, created_at, updated_at FROM memory_rule_links WHERE rule_id = ?").all(ruleId) as MemoryRuleLink[];
  }

  compact(): void { this.db.pragma("wal_checkpoint(TRUNCATE)"); }
  close(): void { this.db.close(); }

  private serialize(record: MemoryRecord): Record<string, unknown> {
    return {
      ...record,
      state: record.state || "candidate",
      support_count: record.support_count || 1,
      independent_session_count: record.independent_session_count || 1,
      independent_project_count: record.independent_project_count || 0,
      validation_count: record.validation_count || 0,
      contradiction_count: record.contradiction_count || 0,
      last_validated_at: record.last_validated_at ?? null,
      pattern_type: record.pattern_type || null,
      valid_to: record.valid_to ?? null,
      supersedes: record.supersedes ?? null,
      scene_json: JSON.stringify(record.scene),
      keywords_json: JSON.stringify(record.keywords),
      evidence_json: JSON.stringify(record.evidence),
      namespace_json: JSON.stringify(record.namespace || {}),
      outcome_json: JSON.stringify(record.outcome || {}),
      metadata_json: JSON.stringify(record.metadata || {})
    };
  }

  private deserialize(row: any): MemoryRecord {
    return {
      id: row.id,
      kind: row.kind,
      content: row.content,
      summary: row.summary,
      pattern_type: row.pattern_type || undefined,
      scene: JSON.parse(row.scene_json || '{"tech":[],"functional":[],"business":[]}'),
      keywords: JSON.parse(row.keywords_json || "[]"),
      evidence: JSON.parse(row.evidence_json || "[]"),
      confidence: row.confidence,
      importance: row.importance,
      strength: row.strength,
      created_at: row.created_at,
      updated_at: row.updated_at,
      valid_from: row.valid_from,
      valid_to: row.valid_to || undefined,
      status: row.status,
      state: (row.state || "candidate") as MemoryState,
      support_count: Number(row.support_count || 1),
      independent_session_count: Number(row.independent_session_count || 1),
      independent_project_count: Number(row.independent_project_count || 0),
      validation_count: Number(row.validation_count || 0),
      contradiction_count: Number(row.contradiction_count || 0),
      last_validated_at: row.last_validated_at || undefined,
      supersedes: row.supersedes || undefined,
      namespace: JSON.parse(row.namespace_json || "{}"),
      outcome: JSON.parse(row.outcome_json || "{}"),
      metadata: JSON.parse(row.metadata_json || "{}"),
      entities: this.db.prepare("SELECT entity_id as id, name, type FROM memory_entities WHERE memory_id = ?").all(row.id) as any[],
      relations: this.db.prepare("SELECT subject, predicate, object, valid_from, valid_to FROM memory_relations WHERE memory_id = ?").all(row.id) as any[]
    };
  }
}

export function createDefaultMemoryRepository(): MemoryRepository {
  try {
    return new SQLiteMemoryStore();
  } catch {
    // Native SQLite binaries can be unavailable in copied/containerized
    // installations. Keep memory learning available through JSONL until the
    // native dependency is repaired.
    return new MemoryStore();
  }
}
