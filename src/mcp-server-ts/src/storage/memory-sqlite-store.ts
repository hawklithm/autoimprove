import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { MemoryMutation, MemoryRecord, MemoryRepository, MemorySearchResult, MemoryUsageEvent } from "../core/memory-models.js";
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
  }

  list(options: { activeOnly?: boolean; kind?: MemoryRecord["kind"]; projectPath?: string } = {}): MemoryRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.activeOnly) clauses.push("status = 'active'");
    if (options.kind) { clauses.push("kind = ?"); params.push(options.kind); }
    const rows = this.db.prepare(`SELECT * FROM memories ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC`).all(...params) as any[];
    return rows.map(row => this.deserialize(row)).filter(record => !options.projectPath || !record.namespace?.project_path || record.namespace.project_path === options.projectPath);
  }

  search(query: string, limit = 8, filters: { projectPath?: string; kind?: MemoryRecord["kind"] } = {}): MemoryRecord[] {
    return this.searchScored(query, limit, filters).map(result => result.memory);
  }

  searchScored(query: string, limit = 8, filters: { projectPath?: string; kind?: MemoryRecord["kind"] } = {}): MemorySearchResult[] {
    const tokens = query.toLowerCase().split(/[^\p{L}\p{N}_+#.-]+/u).filter(Boolean);
    if (tokens.length === 0) return [];
    const like = tokens.map(() => "(content LIKE ? OR summary LIKE ? OR keywords_json LIKE ? OR namespace_json LIKE ?)").join(" OR ");
    const params = tokens.flatMap(token => [`%${token}%`, `%${token}%`, `%${token}%`, `%${token}%`]);
    const rows = this.db.prepare(`SELECT * FROM memories WHERE status = 'active' AND (${like}) ORDER BY updated_at DESC LIMIT ?`).all(...params, Math.max(limit * 5, 20)) as any[];
    return rows.map(row => this.deserialize(row)).filter(memory =>
      (!filters.kind || memory.kind === filters.kind) &&
      (!filters.projectPath || !memory.namespace?.project_path || memory.namespace.project_path === filters.projectPath)
    ).map(memory => {
      const haystack = `${memory.content} ${memory.summary} ${memory.keywords.join(" ")}`.toLowerCase();
      const matched = tokens.filter(token => haystack.includes(token)).length;
      const lexical = matched / Math.max(1, tokens.length);
      const semantic = charSimilarity(query, `${memory.content} ${memory.summary}`);
      const score = semantic * 0.25 + lexical * 0.4 + memory.importance * 0.15 + Math.min(1, memory.strength / 5) * 0.1 + (memory.outcome?.status === "success" ? 0.1 : 0);
      return { memory, score, reasons: [`sqlite-keyword:${lexical.toFixed(2)}`, `char-semantic:${semantic.toFixed(2)}`] };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
  }

  apply(mutation: MemoryMutation): MemoryRecord {
    const record = mutation.memory;
    const tx = this.db.transaction(() => {
      if (mutation.previous_id && mutation.decision === "SUPERSEDE") {
        this.db.prepare("UPDATE memories SET status = 'superseded', valid_to = ?, updated_at = ? WHERE id = ?").run(record.valid_from, record.updated_at, mutation.previous_id);
      }
      this.db.prepare(`INSERT INTO memories (id, kind, content, summary, pattern_type, scene_json, keywords_json, evidence_json, confidence, importance, strength, created_at, updated_at, valid_from, valid_to, status, supersedes, namespace_json, outcome_json, metadata_json)
        VALUES (@id,@kind,@content,@summary,@pattern_type,@scene_json,@keywords_json,@evidence_json,@confidence,@importance,@strength,@created_at,@updated_at,@valid_from,@valid_to,@status,@supersedes,@namespace_json,@outcome_json,@metadata_json)
        ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, content=excluded.content, summary=excluded.summary, pattern_type=excluded.pattern_type, scene_json=excluded.scene_json, keywords_json=excluded.keywords_json, evidence_json=excluded.evidence_json, confidence=excluded.confidence, importance=excluded.importance, strength=excluded.strength, updated_at=excluded.updated_at, valid_to=excluded.valid_to, status=excluded.status, supersedes=excluded.supersedes, namespace_json=excluded.namespace_json, outcome_json=excluded.outcome_json, metadata_json=excluded.metadata_json`).run(this.serialize(record));
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
      this.db.prepare("UPDATE memories SET strength = MAX(0, strength + ?), updated_at = ? WHERE id = ?").run(delta, new Date().toISOString(), memoryId);
    })();
  }

  compact(): void { this.db.pragma("wal_checkpoint(TRUNCATE)"); }
  close(): void { this.db.close(); }

  private serialize(record: MemoryRecord): Record<string, unknown> {
    return {
      ...record,
      pattern_type: record.pattern_type || null,
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
