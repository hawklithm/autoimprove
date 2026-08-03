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
  state TEXT NOT NULL DEFAULT 'candidate',
  support_count INTEGER NOT NULL DEFAULT 1,
  independent_session_count INTEGER NOT NULL DEFAULT 1,
  independent_project_count INTEGER NOT NULL DEFAULT 0,
  validation_count INTEGER NOT NULL DEFAULT 0,
  contradiction_count INTEGER NOT NULL DEFAULT 0,
  last_validated_at TEXT,
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

CREATE TABLE IF NOT EXISTS memory_rule_links (
  memory_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  support_score REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(memory_id, rule_id),
  FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(namespace_json);
CREATE INDEX IF NOT EXISTS idx_memory_entities_name ON memory_entities(name);
CREATE INDEX IF NOT EXISTS idx_memory_relations_key ON memory_relations(subject, predicate, object);
CREATE INDEX IF NOT EXISTS idx_memory_rule_links_rule ON memory_rule_links(rule_id);
