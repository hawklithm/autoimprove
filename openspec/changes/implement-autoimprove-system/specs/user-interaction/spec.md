## ADDED Requirements

### Requirement: Use progressive disclosure for complexity
The system SHALL show simple summaries first, with option to expand for full details.

#### Scenario: Brief summary default
- **WHEN** skill completes analysis
- **THEN** shows 2-3 sentence summary without overwhelming details

#### Scenario: Details on demand
- **WHEN** user wants more information
- **THEN** provides "Show details" option to expand

### Requirement: Require user confirmation for rule activation
The system SHALL never activate rules without explicit user approval.

#### Scenario: New rule confirmation
- **WHEN** rule is generated
- **THEN** system prompts "Activate this rule?" before saving

#### Scenario: Batch confirmation
- **WHEN** multiple rules generated
- **THEN** system offers "Review individually" or "Activate all" options

### Requirement: Handle rule conflicts gracefully
The system SHALL detect when new rule conflicts with existing rule and prompt user to resolve.

#### Scenario: Conflicting rules detected
- **WHEN** new rule contradicts existing rule
- **THEN** system shows both rules and asks which to keep

#### Scenario: User chooses resolution
- **WHEN** user selects rule to keep
- **THEN** system archives conflicting rule with reason

### Requirement: Provide clear rule explanations
The system SHALL explain each rule with context about why it was learned.

#### Scenario: Rule presentation
- **WHEN** showing rule to user
- **THEN** includes what to do, why, and where it came from

#### Scenario: Pattern history
- **WHEN** user asks for details
- **THEN** shows all occurrences that led to rule

### Requirement: Allow rule override in session
The system SHALL let users explicitly override rules when needed without permanent changes.

#### Scenario: Temporary override
- **WHEN** user says "ignore that rule for now"
- **THEN** rule is skipped for current session only

#### Scenario: Permanent override
- **WHEN** user says "don't use this rule anymore"
- **THEN** system archives rule permanently

### Requirement: Show confidence levels transparently
The system SHALL display confidence scores so users understand rule reliability.

#### Scenario: Confidence display
- **WHEN** presenting rule
- **THEN** shows confidence as percentage or level (high/medium/low)

#### Scenario: Low confidence warning
- **WHEN** rule has confidence < 0.5
- **THEN** adds note "Based on limited evidence"

### Requirement: Provide feedback mechanism
The system SHALL allow users to report incorrect or unhelpful rules.

#### Scenario: Rule feedback
- **WHEN** user marks rule as incorrect
- **THEN** system archives rule and adjusts pattern detection

#### Scenario: Positive feedback
- **WHEN** user confirms rule was helpful
- **THEN** system increases rule confidence

### Requirement: Use non-intrusive notifications
The system SHALL avo interrupting user workflow with rule suggestions.

#### Scenario: Passive rule loading
- **WHEN** session starts
- **THEN** rules loaded silently into context

#### Scenario: Conflict notification only
- **WHEN** user action conflicts with rule
- **THEN** gentle reminder shown, not blocking

### Requirement: Support rule discovery
The system SHALL help users explore what rules exist and when they apply.

#### Scenario: Rule browsing
- **WHEN** user runs /autoimprove-lessons
- **THEN** shows all applicable rules for current scene

#### Scenario: Rule search
- **WHEN** user sehes by keyword
- **THEN** finds relevant rules across all scenes
