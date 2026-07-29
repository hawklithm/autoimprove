CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  pattern_type TEXT,
  scene_json TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  importance REAL NOT NULL,
  strength REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  status TEXT NOT NULL,
  supersedes TEXT,
  namespace_json TEXT,
  outcome_json TEXT,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS memory_versions (
  version_id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  versioned_at TEXT NOT NULL,
  decision TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_entities (
  memory_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  PRIMARY KEY(memory_id, entity_id)
);

CREATE TABLE IF NOT EXISTS memory_relations (
  memory_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY(memory_id, subject, predicate, object)
);

CREATE TABLE IF NOT EXISTS memory_usage (
  usage_id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  event TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(namespace_json);
CREATE INDEX IF NOT EXISTS idx_memory_entities_name ON memory_entities(name);
CREATE INDEX IF NOT EXISTS idx_memory_relations_key ON memory_relations(subject, predicate, object);
