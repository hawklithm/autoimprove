## ADDED Requirements

### Requirement: Implement autoimprove-summarize skill
The system SHALL provide skill to analyze completed session and generate summary with learned patterns.

#### Scenario: Session summary generation
- **WHEN** user runs /autoimprove-summarize after session
- **THEN** skill analyzes session, detects patterns, and presents summary

#### Scenario: No patterns found
- **WHEN** session has no detectable patterns
- **THEN** skill reports "No new patterns detected" with explanation

### Requirement: Implement autoimprove-rules skill
The system SHALL provide skill to review and confirm generated rules before activation.

#### Scenario: Rule confirmation workflow
- **WHEN** user runs /autoimprove-rules
- **THEN** skill shows pending rules and prompts for confirmation

#### Scenario: Rule rejection
- **WHEN** user rejects a rule
- **THEN** skill archives rule and explains why it won't be used

### Requirement: Implement autoimprove-lessons skill
The system SHALL provide skill to view applicable rules for current scene.

#### Scenario: Scene-specific lessons
- **WHEN** user runs /autoimprove-lessons
- **THEN** skill detects current scene and shows relevant rules

#### Scenario: No applicable rules
- **WHEN** current scene has no matching rules
- **THEN** skill reports "No lessons yet for this scene"

### Requirement: Implement autoimprove-status skill
The system SHALL provide skill to show system status and statistics.

#### Scenario: Status display
- **WHEN** user runs /autoimprove-status
- **THEN** skill shows total rules, recent activity, and storage info

#### Scenario: First-time initialization
- **WHEN** user runs status before initialization
- **THEN** skill initializes storage and shows welcome message

### Requirement: Coordinate multiple MCP tool calls
The system SHALL orchestrate complex workflows using multiple MCP tools in sequence.

#### Scenario: Summarize workflow
- **WHEN** autoimprove-summarize runs
- **THEN** skill calls analyze_session, then generate_rules, then update_rules

#### Scenario: Error handling in workflow
- **WHEN** intermediate tool call fails
- **THEN** skill reports error and stops workflow gracefully

### Requirement: Present results with progressive disclosure
The system SHALL show brief summaries first, with option to expand for details.

#### Scenario: Summary view
- **WHEN** skill completes
- **THEN** shows 2-3 sentence summary with "Show details" option

#### Scenario: Detailed view
- **WHEN** user requests details
- **THEN** shows full pattern analysis and rule content

### Requirement: Handle user confirmations
The system SHALL prompt for user confirmation before activating rules or making changes.

#### Scenario: Rule activation prompt
- **WHEN** new rules generated
- **THEN** skill asks "Activate these rules?" with yes/no options

#### Scenario: Batch confirmation
- **WHEN** multiple rules pending
- **THEN** skill allows confirm all, review individually, or reject all

### Requirement: Provide contextual help
The system SHALL offer guidance when users are unsure what to do.

#### Scenario: First-time user
- **WHEN** user runs skill for first time
- **THEN** skill shows brief explanation of what it does

#### Scenario: Empty state
- **WHEN** no data available yet
- **THEN** skill explains how to start building knowledge
