-- AutoImprove Rule Storage Schema
-- SQLite version for enhanced querying performance

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
);

INSERT OR IGNORE INTO schema_versions (version, applied_at, description)
VALUES (1, strftime('%s', 'now') * 1000, 'Initial SQLite schema');

-- =============================================================================
-- Core Tables
-- =============================================================================

-- Rules: Main rule metadata
CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('critical', 'high', 'medium', 'low')),
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    status TEXT NOT NULL DEFAULT 'active',
    last_validated_at TEXT,
    last_applied_at TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0,
    acceptance_count INTEGER NOT NULL DEFAULT 0,
    correction_count INTEGER NOT NULL DEFAULT 0,
    contradiction_count INTEGER NOT NULL DEFAULT 0,

    -- Scene fields (JSON arrays)
    tech_scene TEXT NOT NULL DEFAULT '[]',
    functional_scene TEXT NOT NULL DEFAULT '[]',
    business_scene TEXT NOT NULL DEFAULT '[]',

    -- Scope fields
    scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'organization', 'project')),
    scope_project_path TEXT,
    scope_project_id TEXT,
    scope_organization_id TEXT,
    scope_team_id TEXT,
    scope_repository TEXT,
    scope_branch TEXT,
    scope_confidence REAL,
    scope_reason TEXT,
    source_memory_ids TEXT NOT NULL DEFAULT '[]',

    -- Metadata
    keywords TEXT NOT NULL DEFAULT '[]', -- JSON array
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    -- Content reference
    content_file TEXT NOT NULL
);

-- Full-text search index (critical for performance)
CREATE VIRTUAL TABLE IF NOT EXISTS rules_fts USING fts5(
    rule_id UNINDEXED,
    title,
    description,
    how_to_apply,
    when_to_use,
    exceptions,
    keywords,
    content='',  -- External content (not stored in FTS table)
    tokenize='porter unicode61'  -- Porter stemming + Unicode support
);

-- Scene reverse index (fast scene-based filtering)
CREATE TABLE IF NOT EXISTS scene_index (
    scene_dimension TEXT NOT NULL CHECK(scene_dimension IN ('tech', 'functional', 'business')),
    scene_value TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    PRIMARY KEY (scene_dimension, scene_value, rule_id),
    FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
);

-- Keyword segments (inspired by CodeGraph's name_segment_vocab)
CREATE TABLE IF NOT EXISTS keyword_segments (
    segment TEXT NOT NULL,
    rule_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('keyword', 'title', 'description', 'id')),
    PRIMARY KEY (segment, rule_id),
    FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
) WITHOUT ROWID;

-- =============================================================================
-- Performance Indexes
-- =============================================================================

-- Rule indexes
CREATE INDEX IF NOT EXISTS idx_rules_confidence ON rules(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority);
CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(type);
CREATE INDEX IF NOT EXISTS idx_rules_scope ON rules(scope, scope_project_path);

-- Scene index lookups
CREATE INDEX IF NOT EXISTS idx_scene_dimension_value ON scene_index(scene_dimension, scene_value);
CREATE INDEX IF NOT EXISTS idx_scene_rule ON scene_index(rule_id);

-- Keyword segment lookups
CREATE INDEX IF NOT EXISTS idx_keyword_segment ON keyword_segments(segment);
CREATE INDEX IF NOT EXISTS idx_keyword_rule ON keyword_segments(rule_id);

-- =============================================================================
-- Migration Helpers
-- =============================================================================

-- Temporary table for JSON migration
CREATE TABLE IF NOT EXISTS migration_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    action TEXT NOT NULL,
    details TEXT
);
