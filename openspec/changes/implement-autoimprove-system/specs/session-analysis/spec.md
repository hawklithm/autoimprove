## ADDED Requirements

### Requirement: Parse session JSONL files
The system SHALL parse Claude Code session files in JSONL format and extract user messages, assistant messages, and tool calls.

#### Scenario: Valid JSONL file
- **WHEN** system receives a valid session JSONL file path
- **THEN** system extracts all messages with role, content, and timestamp

#### Scenario: Malformed JSONL
- **WHEN** system encounters invalid JSON lines
- **THEN** system skips malformed lines and continues parsing

### Requirement: Detect repeated correction patterns
The system SHALL identify patterns where users correct the same mistake across multiple sessions.

#### Scenario: Cross-session repetition
- **WHEN** user corrects the same issue in 2+ different sessions
- **THEN** system creates a repeated-correction pattern with occurrences from each session

#### Scenario: Same-session multiple corrections
- **WHEN** user corrects the same issue 3+ times in one session
- **THEN** system applies frequency bonus (+0.1) to confidence score

### Requirement: Detect anti-pattern occurrences
The system SHALL identify code patterns that lead to test failures or explicit user corrections.

#### Scenario: Test failure followed by correction
- **WHEN** test fails, user corrects code, then test passes
- **THEN** system creates anti-pattern with test validation evidence

#### Scenario: Framework rule violation
- **WHEN** user correction mentions framework-specific rules (React hooks, Vue reactivity)
- **THEN** system marks as framework rule and lowers confidence threshold to 0.3

### Requirement: Detect user preferences
The system SHALL identify user or team coding preferences from explicit statements.

#### Scenario: Team convention keyword
- **WHEN** user input contains keywords like "我们团队", "we prefer", "convention"
- **THEN** system creates preference pattern with keyword bonus (+0.2)

#### Scenario: Accept action
- **WHEN** user accepts a suggestion without explicit correction
- **THEN** system counts as valid behavior for preference patterns

### Requirement: Detect performance patterns
The system SHALL identify performance optimization patterns with measurable improvements.

#### Scenario: Performance improvement evidence
- **WHEN** user mentions performance keywords and provides improvement evidence
- **THEN** system creates performance pattern with validation score

#### Scenario: Performance keywords
- **WHEN** user input contains "useMemo", "optimize", "slow", "卡顿"
- **THEN** system applies keyword bonus (+0.2)

### Requirement: Detect security issues
The system SHALL identify security-related corrections with highest priority.

#### Scenario: Security keyword detection
- **WHEN** user input contains "sql injection", "xss", "csrf", "安全"
- **THEN** system creates security pattern with 1.5x weight adjustment

#### Scenario: Single occurrence security rule
- **WHEN** security pattern appears once with confidence >= 0.3
- **THEN** system generates rule with critical priority

### Requirement: Calculate confidence scores
The system SHALL calculate pattern confidence using weighted formula: frequency (0.3) + timespan (0.1) + behavior (0.4) + validation (0.2).

#### Scenario: High confidence pattern
- **WHEN** pattern has multiple occurrences, explicit corrections, and test validation
- **THEN** confidence score >= 0.7

#### Scenario: Low confidence pattern
- **WHEN** pattern has single occurrence without validation
- **THEN** confidence score < 0.5

### Requirement: Apply classification strategies
The system SHALL use different confidence thresholds per pattern type: repeated-correction (0.45), anti-pattern (0.45), preference (0.3), performance (0.4), security (0.3).

#### Scenario: Preference with low confidence
- **WHEN** preference pattern has confidence 0.35
- **THEN** system generates rule (threshold 0.3)

#### Scenario: Anti-pattern below threshold
- **WHEN** anti-pattern has confidence 0.40
- **THEN** system rejects rule generation (threshold 0.45)

### Requirement: Extract pattern context
The system SHALL capture file paths, line numbers, and surrounding code context for each pattern occurrence.

#### Scenario: File context extraction
- **WHEN** pattern detected in tool call with file_path parameter
- **THEN** system records file path and context in occurrence

#### Scenario: User input preservation
- **WHEN** user provides correction message
- **THEN** system stores full user input for keyword detection
