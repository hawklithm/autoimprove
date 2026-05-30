## ADDED Requirements

### Requirement: Store rules in index file
The system SHALL maintain a lightweight index file (`~/.autoimprove/rules/index.json`) with rule metadata for fast loading.

#### Scenario: Index structure
- **WHEN** rules are stored
- **THEN** index contains id, type, scenes, priority, confidence for each rule

#### Scenario: Fast index loading
- **WHEN** system starts
- **THEN** index loads in < 100ms without reading full rule content

### Requirement: Store rule content separately
The system SHALL store full rule content in individual markdown files (`~/.autoimprove/rules/content/rule-{id}.md`).

#### Scenario: Content file format
- **WHEN** rule is saved
- **THEN** content file includes frontmatter with metadata and markdown body

#### Scenario: Lazy content loading
- **WHEN** rule is matched
- **THEN** system loads content file only when needed

### Requirement: Archive session data
The system SHALL save analyzed session data to `~/.autoimprove/sessions/{session_id}.json` for future reference.

#### Scenario: Session persistence
- **WHEN** session is analyzed
- **THEN** patterns and metadata are saved to session file

#### Scenario: Session retrieval
- **WHEN** user queries past sessions
- **THEN** system loads session data from archive

### Requirement: Maintain global configuration
The system SHALL store user preferences in `~/.autoimprove/config.json`.

#### Scenario: Default configuration
- **WHEN** system initializes
- **THEN** config file created with default settings

#### Scenario: Configuration updates
- **WHEN** user changes settings
- **THEN** config file is updated atomically

### Requirement: Cache temporary data
The system SHALL use `~/.autoimprove/cache/` for temporary analysis results.

#### Scenario: Cache invalidation
- **WHEN** source data changes
- **THEN** cache is invalidated automatically

#### Scenario: Cache cleanup
- **WHEN** cache exceeds size limit
- **THEN** oldest entries are removed

### Requirement: Support atomic writes
The system SHALL use atomic file operations to prevent data corruption.

#### Scenario: Write-then-rename
- **WHEN** updating index or rules
- **THEN** system writes to temp file then renames atomically

#### Scenario: Concurrent access
- **WHEN** multiple processes access storage
- **THEN** file locks prevent corruption

### Requirement: Handle storage errors gracefully
The system SHALL provide clear error messages for storage failures.

#### Scenario: Disk full
- **WHEN** storage write fails due to disk space
- **THEN** system reports error and suggests cleanup

#### Scenario: Permission denied
- **WHEN** storage directory is not writable
- **THEN** system reports permission error with directory path

### Requirement: Support storage migration
The system SHALL detect and migrate old storage formats to new versions.

#### Scenario: Version detection
- **WHEN** system loads storage
- **THEN** version is checked against current schema

#### Scenario: Automatic migration
- **WHEN** old version detected
- **THEN** data is migrated to new format with backup
