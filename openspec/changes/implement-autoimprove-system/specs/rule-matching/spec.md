## ADDED Requirements

### Requirement: Match rules by scene overlap
The system SHALL match rules to current session based on scene dimension overlap.

#### Scenario: Exact tech stack match
- **WHEN** current scene has tech="react" and rule has tech="react"
- **THEN** rule is matched with high relevance score

#### Scenario: Partial scene match
- **WHEN** current scene matches 2 of 3 rule scene dimensions
- **THEN** rule is matched with medium relevance score

### Requirement: Filter by confidence threshold
The system SHALL only match rules above minimum confidence threshold (default 0.3).

#### Scenario: High confidence rule
- **WHEN** rule has confidence 0.8
- **THEN** rule is included in matches

#### Scenario: Low confidence rule
- **WHEN** rule has confidence 0.2
- **THEN** rule is excluded from matches

### Requirement: Rank matches by priority
The system SHALL sort matched rules by priority (critical > high > medium > low) then confidence.

#### Scenario: Priority ordering
- **WHEN** multiple rules match
- **THEN** critical priority rules appear first

#### Scenario: Same priority ordering
- **WHEN** rules have same priority
- **THEN** higher confidence rules appear first

### Requirement: Support keyword-based matching
The system SHALL boost match relevance when rule keywords appear in current context.

#### Scenario: Keyword match boost
- **WHEN** rule keywords found in current file or user message
- **THEN** relevance score increased by 0.2

#### Scenario: No keyword match
- **WHEN** rule keywords not found
- **THEN** relevance based only on scene overlap

### Requirement: Limit match results
The system SHALL return top N matched rules (configurable, default 10) to avoid context overflow.

#### Scenario: Many matches
- **WHEN** 20 rules match current scene
- **THEN** only top 10 by relevance are returned

#### Scenario: Few matches
- **WHEN** 3 rules match current scene
- **THEN** all 3 are returned

### Requirement: Cache match results per session
The system SHALL cache rule matching results to avoid repeated computation.

#### Scenario: First match in session
- **WHEN** rules matched for first time
- **THEN** results cached for session

#### Scenario: Scene change in session
- **WHEN** scene changes (new files analyzed)
- **THEN** match cache is invalidated and recomputed

### Requirement: Support manual rule selection
The system SHALL allow users to manually include/exclude specific rules.

#### Scenario: User includes rule
- **WHEN** user explicitly requests rule by ID
- **THEN** rule is included regardless of scene match

#### Scenario: User excludes rule
- **WHEN** user explicitly excludes rule by ID
- **THEN** rule is excluded even if scene matches

### Requirement: Track rule usage statistics
The system SHALL record when rules are matched and applied.

#### Scenario: Match tracking
- **WHEN** rule is matched to session
- **THEN** match count is incremented

#### Scenario: Application tracking
- **WHEN** rule is actually used (not overridden)
- **THEN** application count is incremented
