## ADDED Requirements

### Requirement: Generate rule from pattern
The system SHALL convert validated patterns into structured rules with content, reason, scenes, and metadata.

#### Scenario: Repeated correction rule
- **WHEN** repeated-correction pattern passes confidence threshold
- **THEN** system generates rule with description, reason, and applicable scenes

#### Scenario: Security rule priority
- **WHEN** security pattern generates rule
- **THEN** system assigns critical priority automatically

### Requirement: Determine rule priority
The system SHALL assign priority levels (critical, high, medium, low) based on pattern type and confidence.

#### Scenario: High confidence boost
- **WHEN** pattern confidence >= 0.9
- **THEN** system increases priority by one level (medium → high, low → medium)

#### Scenario: Security critical priority
- **WHEN** pattern type is security
- **THEN** system assigns critical priority regardless of confidence

### Requirement: Extract rule content
The system SHALL generate clear, actionable rule content from pattern description and occurrences.

#### Scenario: Rule content clarity
- **WHEN** generating rule from pattern
- **THEN** content describes what to do, not what was wrong

#### Scenario: Context preservation
- **WHEN** pattern has specific file or function context
- **THEN** rule content includes relevant context

### Requirement: Generate rule reason
The system SHALL explain why the rule exists based on pattern history.

#### Scenario: Test failure reason
- **WHEN** pattern includes test failures
- **THEN** reason mentions test validation

#### Scenario: User preference reason
- **WHEN** pattern is preference type
- **THEN** reason cites team convention or user preference

### Requirement: Assign rule scenes
The system SHALL detect and assign applicable scenes (tech stack, functional domain, business domain) to rules.

#### Scenario: Tech stack detection
- **WHEN** pattern occurs in React files
- **THEN** rule includes "react" in tech scenes

#### Scenario: Functional domain detection
- **WHEN** pattern occurs in authentication code
- **THEN** rule includes "auth" in functional scenes

### Requirement: Include pattern metadata
The system SHALL preserve pattern metadata (keywords, occurrences, confidence) in generated rules.

#### Scenario: Keyword preservation
- **WHEN** pattern has detected keywords
- **THEN** rule includes keywords for future matching

#### Scenario: Confidence recording
- **WHEN** rule is generated
- **THEN** rule stores original pattern confidence

### Requirement: Generate unique rule IDs
The system SHALL assign unique, sequential IDs to generated rules.

#### Scenario: ID uniqueness
- **WHEN** multiple rules generated in same session
- **THEN** each rule has unique ID

#### Scenario: ID persistence
- **WHEN** rule is stored
- **THEN** ID remains stable across sessions

### Requirement: Set rule timestamps
The system SHALL record creation and update timestamps for rules.

#### Scenario: Creation timestamp
- **WHEN** rule is first generated
- **THEN** created_at is set to current time

#### Scenario: Update timestamp
- **WHEN** rule is modified
- **THEN** updated_at is updated to current time
