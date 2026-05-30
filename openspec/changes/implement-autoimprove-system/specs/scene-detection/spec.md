## ADDED Requirements

### Requirement: Detect tech stack from file paths
The system SHALL infer tech stack from file extensions and directory structure.

#### Scenario: React detection
- **WHEN** files have .tsx/.jsx extensions or import React
- **THEN** scene includes "react" in tech dimension

#### Scenario: Vue detection
- **WHEN** files have .vue extension
- **THEN** scene includes "vue" in tech dimension

### Requirement: Detect functional domain from file paths
The system SHALL infer functional domain from directory names and file paths.

#### Scenario: Auth domain detection
- **WHEN** files are in /auth/ or /authentication/ directories
- **THEN** scene includes "auth" in functional dimension

#### Scenario: API domain detection
- **WHEN** files are in /api/ or /services/ directories
- **THEN** scene includes "api" in functional dimension

### Requirement: Infer business domain from context
The system SHALL attempt to infer business domain from code content and user messages.

#### Scenario: E-commerce keywords
- **WHEN** code mentions "cart", "checkout", "payment"
- **THEN** scene includes "e-commerce" in business dimension

#### Scenario: User explicit mention
- **WHEN** user mentions business domain in messages
- **THEN** scene includes mentioned domain in business dimension

### Requirement: Support manual business domain configuration
The system SHALL allow users to configure business domain mappings in config file.

#### Scenario: Custom domain mapping
- **WHEN** user defines path → domain mapping in config
- **THEN** system uses configured mapping for scene detection

#### Scenario: Override inference
- **WHEN** both inference and config provide domains
- **THEN** config takes precedence

### Requirement: Calculate scene confidence
The system SHALL assign confidence scores to detected scenes based on signal strength.

#### Scenario: High confidence tech stack
- **WHEN** multiple files use same framework
- **THEN** tech stack confidence >= 0.8

#### Scenario: Low confidence business domain
- **WHEN** business domain inferred from weak signals
- **THEN** business domain confidence < 0.6

### Requirement: Support multi-dimensional scenes
The system SHALL allow scenes to have multiple values per dimension.

#### Scenario: Multiple tech stacks
- **WHEN** project uses React and TypeScript
- **THEN** scene includes both in tech dimension

#### Scenario: Multiple functional domains
- **WHEN** code spans auth and api domains
- **THEN** scene includes both in functional dimension

### Requirement: Cache scene detection results
The system SHALL cache scene detection results per session to avoid recomputation.

#### Scenario: Session-level caching
- **WHEN** scene detected for session
- **THEN** result is cached for session duration

#### Scenario: Cache invalidation
- **WHEN** new files are analyzed in session
- **THEN** scene cache is updated incrementally

### Requirement: Provide scene detection API
The system SHALL expose scene detection as MCP tool for external use.

#### Scenario: Tool invocation
- **WHEN** MCP client calls detect_scene tool* system returns scene with confidence scores

#### Scenario: Batch detection
- **WHEN** multiple file paths provided
- **THEN** system returns aggregated scene
