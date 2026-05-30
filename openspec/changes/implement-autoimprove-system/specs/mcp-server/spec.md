## ADDED Requirements

### Requirement: Implement analyze_session tool
The system SHALL provide MCP tool to analyze session JSONL files and extract patterns.

#### Scenario: Tool invocation
- **WHEN** MCP client calls analyze_session with session file path
- **THEN** system returns detected patterns with confidence scores

#### Scenario: Invalid file path
- **WHEN** session file path does not exist
- **THEN** tool returns error with clear message

### Requirement: Implement generate_rules tool
The system SHALL provide MCP tool to generate rules from validated patterns.

#### Scenario: Pattern to rule conversion
- **WHEN** MCP client calls generate_rules with patterns
- **THEN** system returns generated rules with IDs

#### Scenario: Below threshold patterns
- **WHEN** patterns below confidence threshold provided
- **THEN** tool returns empty list with explanation

### Requirement: Implement search_knowledge tool
The system SHALL provide MCP tool to search rules by scene, keyword, or ID.

#### Scenario: Scene-based search
- **WHEN** MCP client searches by scene
- **THEN** system returns matched rules sorted by relevance

#### Scenario: Keyword search
- **WHEN** MCP client searches by keyword
- **THEN** system returns rules containing keyword

### Requirement: Implement update_rules tool
The system SHALL provide MCP tool to modify existing rules (content, priority, scenes).

#### Scenario: Rule content update
- **WHEN** MCP client updates rule content
- **THEN** system updates rule and increments version

#### Scenario: Rule archival
- **WHEN** MCP client archives rule
- **THEN** rule is moved to archive and excluded from matching

### Requirement: Implement list_scenes tool
The system SHALL provide MCP tool to list all known scenes from rules and sessions.

#### Scenario: Scene enumeration
- **WHEN** MCP client calls list_scenes
- **THEN** system returns all unique scenes with usage counts

#### Scenario: Scene filtering
- **WHEN** MCP client filters by dimension
- **THEN** system returns scenes for that dimension only

### Requirement: Provide rules resource
The system SHALL expose rules as MCP resource at `knowledge://rules/{id}`.

#### Scenario: Resource read
- **WHEN** MCP client reads knowledge://rules/001
- **THEN** system returns full rule content in markdown

#### Scenario: Resource list
- **WHEN** MCP client lists knowledge://rules/
- **THEN** system returns all Ds with metadata

### Requirement: Provide lessons resource
The system SHALL expose scene-specific lessons as MCP resource at `knowledge://lessons/{scene}`.

#### Scenario: Scene lessons
- **WHEN** MCP client reads knowledge://lessons/react-auth
- **THEN** system returns all rules applicable to that scene

#### Scenario: No lessons found
- **WHEN** scene has no applicable rules
- **THEN** resource returns empty with explanation

### Requirement: Handle concurrent requests
The system SHALL safely handle multiple concurrent MCP tool calls.

#### Scenario: Parallel analysis
- **WHEN** multiple analyze_session calls in parallel
- **THEN** each completes without interference

#### Scenario: Read-write conflict
- **WHEN** search and update called concurrently
- **THEN** operations are serialized safely

### Requirement: Provide server health check
The system SHALL expose health check endpoint for monitoring.

#### Scenario: Healthy server
- **WHEN** health check called
- **THEN** returns status OK with storage info

#### Scenario: Storage unavailable
- **WHEN** storage directory not accessible
- **THEN** returns status ERROR with details

### Requirement: Log tool invocations
The system SHALL log all MCP tool calls for deing and analytics.

#### Scenario: Tool call logging
- **WHEN** any tool is invoked
- **THEN** log includes tool name, parameters, and timestamp

#### Scenario: Error logging
- **WHEN** tool call fails
- **THEN** log includes full error details and stack trace
