# Adaptive Pattern Recognition System - API Documentation

## Overview

This document covers the API for AutoImprove's adaptive learning system (v2.2+). The adaptive system uses signal-based pattern recognition, LLM extraction, Bayesian confidence updates, and pattern clustering to continuously improve pattern detection.

**Current Status**: Core components implemented, MCP tools planned for v2.3.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Tools Layer                         │
│  (Planned: signal_*, extract_*, cluster_*, bayesian_*)     │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   Core Components                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Signal Match │  │LLM Extractor │  │Bayesian      │      │
│  │(Aho-Corasick│  │(Claude API)  │  │Confidence    │      │
│  └─────────────┘  └──────────────┘  └──────────────┘      │
│  ┌─────────────┐  ┌──────────────┐                        │
│  │Pattern      │  │LLM Rule Gen  │                        │
│  │Clusterer    │  │(Claude API)  │                        │
│  └─────────────┘  └──────────────┘                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                  Storage Layer                              │
│  ~/.autoimprove/signal_dictionary/signals.db (SQLite)      │
└─────────────────────────────────────────────────────────────┘
```

## Core API Reference

### AdaptiveSessionAnalyzer

**Purpose**: Main entry point for adaptive session analysis.

#### `analyzeSession(sessionFile: string, options?: AdaptiveAnalysisOptions): AdaptiveAnalysisResult`

Analyzes a Claude Code session with signal-based pattern recognition.

**Parameters**:

```typescript
interface AdaptiveAnalysisOptions {
  incremental?: boolean;           // Default: true
  forceReanalyze?: boolean;        // Default: false
  useCompactCache?: boolean;       // Default: true
  enableSignalExtraction?: boolean; // Default: true
  enableClustering?: boolean;       // Default: false
  enableRuleGeneration?: boolean;   // Default: false
}
```

**Returns**:

```typescript
interface AdaptiveAnalysisResult {
  patterns: Pattern[];
  signal_matches: {
    total_messages: number;
    matched_messages: number;
    unmatched_messages: number;
    match_rate: number;
  };
  signal_extraction?: {
    new_signals: number;
    total_analyzed: number;
  };
  clustering?: {
    total_clusters: number;
    avg_cluster_size: number;
  };
  rules_generated?: {
    total_rules: number;
    rule_ids: string[];
  };
}
```

**Example**:

```typescript
const analyzer = new AdaptiveSessionAnalyzer();
const result = analyzer.analyzeSession(
  "/path/to/session.jsonl",
  {
    enableSignalExtraction: true,
    enableClustering: false,
    enableRuleGeneration: true
  }
);

console.log(`Match rate: ${result.signal_matches.match_rate}%`);
console.log(`New signals extracted: ${result.signal_extraction?.new_signals}`);
console.log(`Rules generated: ${result.rules_generated?.total_rules}`);
```

---

### SignalDictionaryDB

**Purpose**: Manage signal dictionary storage in SQLite.

#### `addSignal(signal: SignalEntry): number`

Adds a new signal to the dictionary.

**Parameters**:

```typescript
interface SignalEntry {
  text: string;
  language: "zh" | "en" | "mixed";
  pattern_type: "correction" | "anti-pattern" | "preference" | "performance" | "security";
  polarity: "positive" | "negative" | "neutral";
  confidence: number;                // 0.0 - 1.0
  typical_context: string[];         // JSON array
  related_signals: string[];         // JSON array
  match_count?: number;              // Default: 0
  true_positive?: number;            // Default: 0
  false_positive?: number;           // Default: 0
  source: "seed" | "llm_extracted" | "user_added";
}
```

**Returns**: Signal ID (integer)

**Example**:

```typescript
const db = new SignalDictionaryDB();
const signalId = db.addSignal({
  text: "use React.memo to prevent unnecessary re-renders",
  language: "en",
  pattern_type: "performance",
  polarity: "positive",
  confidence: 0.8,
  typical_context: ["react", "optimization", "hooks"],
  related_signals: ["useCallback", "useMemo"],
  source: "llm_extracted"
});
```

#### `getSignal(id: number): SignalEntry | null`

Retrieves a signal by ID.

#### `updateConfidence(id: number, newConfidence: number, reason: string, evidence: object): void`

Updates signal confidence and logs to history.

**Example**:

```typescript
db.updateConfidence(
  signalId,
  0.85,
  "bayesian_update",
  { true_positive: 15, false_positive: 2 }
);
```

#### `getAllSignals(): SignalEntry[]`

Returns all signals (used for building Aho-Corasick automaton).

#### `searchSignals(filters: SignalFilters): SignalEntry[]`

Search signals with filters.

**Parameters**:

```typescript
interface SignalFilters {
  pattern_type?: string;
  language?: string;
  min_confidence?: number;
  text_contains?: string;
}
```

---

### SignalMatcher

**Purpose**: Fast multi-pattern matching using Aho-Corasick algorithm.

#### `matchContent(content: string): MatchResult`

Matches all signals against content.

**Returns**:

```typescript
interface MatchResult {
  content: string;
  matched_signals: MatchedSignal[];
  pattern_type?: string;              // Dominant pattern type
  aggregated_confidence: number;       // Weighted average
  is_matched: boolean;
}

interface MatchedSignal {
  signal_text: string;
  signal_id: number;
  position: number;                   // Character offset
  context_window: string;             // Surrounding text
  confidence: number;
  pattern_type: string;
  polarity: string;
  contribution_weight: number;        // For aggregation
}
```

**Example**:

```typescript
const matcher = new SignalMatcher();
const result = matcher.matchContent(
  "Use React.memo to prevent re-renders and improve performance"
);

console.log(`Matched: ${result.is_matched}`);
console.log(`Confidence: ${result.aggregated_confidence}`);
console.log(`Signals: ${result.matched_signals.length}`);
```

#### `matchBatch(contents: string[]): MatchResult[]`

Batch matching for efficiency.

---

### LLMSignalExtractor

**Purpose**: Extract new signals from unmatched user messages using LLM.

#### `extractSignals(unmatchedContent: string[]): Promise<ExtractionResult>`

Extracts signals from unmatched messages.

**Parameters**: Array of unmatched message texts

**Returns**:

```typescript
interface ExtractionResult {
  extracted_signals: ExtractedSignal[];
  total_analyzed: number;
  total_extracted: number;
  total_added: number;           // After validation
}

interface ExtractedSignal {
  text: string;
  pattern_type: string;
  polarity: string;
  confidence: number;
  keywords: string[];
  related_patterns: string[];
  context?: string;
}
```

**Example**:

```typescript
const extractor = new LLMSignalExtractor();
const unmatchedMessages = [
  "Don't use var, always use const or let",
  "Remember to add error handling to async functions",
  "Avoid nested ternaries, use if-else for readability"
];

const result = await extractor.extractSignals(unmatchedMessages);
console.log(`Extracted: ${result.total_extracted}`);
console.log(`Added to dictionary: ${result.total_added}`);
```

#### Internal: `extractFromBatch(content: string[]): Promise<ExtractedSignal[]>`

Processes one batch (up to 20 messages) via LLM.

**Token Cost**: ~2,000 tokens per batch (input + output)

---

### BayesianConfidenceUpdater

**Purpose**: Update signal confidence based on match outcomes and feedback.

#### `comprehensiveUpdate(signal: SignalEntry, feedback: ConfidenceUpdateFeedback): number`

Updates confidence using Bayesian inference.

**Parameters**:

```typescript
interface ConfidenceUpdateFeedback {
  outcome: "true_positive" | "false_positive" | "uncertain";
  user_rating?: number;          // 1-5
  context?: string;
}
```

**Returns**: New confidence (0.0 - 1.0)

**Formula**:
```
posterior = prior × likelihood / evidence

likelihood = P(outcome | signal valid)
  - TP: 0.9 (signal is valid)
  - FP: 0.1 (signal is invalid)

evidence = P(outcome) = weighted average based on match history
```

**Example**:

```typescript
const updater = new BayesianConfidenceUpdater();
const signal = db.getSignal(signalId);

const newConfidence = updater.comprehensiveUpdate(signal, {
  outcome: "true_positive",
  user_rating: 5,
  context: "User explicitly accepted rule"
});

db.updateConfidence(signalId, newConfidence, "bayesian_update", feedback);
```

#### `updateByCoOccurrence(signal: SignalEntry, coOccurringSignals: SignalEntry[]): number`

Boosts confidence when signal appears with other high-confidence signals.

**Example**:

```typescript
const relatedSignals = db.searchSignals({
  pattern_type: signal.pattern_type,
  min_confidence: 0.7
});

const boostedConfidence = updater.updateByCoOccurrence(signal, relatedSignals);
```

#### `applyTimeDecay(signal: SignalEntry, daysSinceLastSeen: number): number`

Reduces confidence for signals not recently matched.

**Decay Formula**:
```
decay_factor = exp(-days / decay_constant)
decay_constant = 90 days (configurable)

new_confidence = old_confidence × decay_factor
```

#### `batchUpdate(updates: Array<UpdateRequest>): void`

Efficient batch updates for multiple signals.

---

### PatternClusterer

**Purpose**: Group semantically similar patterns to reduce redundancy.

#### `clusterPatterns(patterns: Pattern[]): ClusterResult`

Clusters patterns using TF-IDF + cosine similarity.

**Parameters**: Array of patterns from session analysis

**Returns**:

```typescript
interface ClusterResult {
  clusters: PatternCluster[];
  total_patterns: number;
  total_clusters: number;
  reduction_rate: number;          // Percentage reduction
}

interface PatternCluster {
  id: string;
  representative: Pattern;         // Most confident pattern
  members: Pattern[];
  avg_confidence: number;
  combined_keywords: string[];
  pattern_type: string;
}
```

**Example**:

```typescript
const clusterer = new PatternClusterer();
const result = clusterer.clusterPatterns(patterns);

console.log(`Reduced from ${result.total_patterns} to ${result.total_clusters}`);
console.log(`Reduction: ${result.reduction_rate}%`);

for (const cluster of result.clusters) {
  console.log(`Cluster: ${cluster.representative.description}`);
  console.log(`Members: ${cluster.members.length}`);
}
```

#### Internal: `extractFeatures(content: LabeledContent): ClusterFeatures`

Extracts TF-IDF features for clustering.

#### Internal: `calculateSimilarity(feat1: ClusterFeatures, feat2: ClusterFeatures): number`

Cosine similarity between feature vectors (0.0 - 1.0).

---

### LLMRuleGenerator

**Purpose**: Generate high-quality rules from clustered patterns using LLM.

#### `generateFromClusters(clusters: PatternCluster[]): Promise<GeneratedRule[]>`

Generates rules from pattern clusters.

**Parameters**: Array of pattern clusters

**Returns**:

```typescript
interface GeneratedRule {
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  keywords: string[];
  examples: RuleExample[];
  confidence: number;
  source_patterns: string[];      // Pattern IDs
}

interface RuleExample {
  before: string;                  // Anti-pattern code
  after: string;                   // Correct code
  explanation: string;
}
```

**Token Cost**: ~800 tokens per cluster (input + output)

**Example**:

```typescript
const generator = new LLMRuleGenerator();
const rules = await generator.generateFromClusters(clusterResult.clusters);

for (const rule of rules) {
  console.log(`Generated: ${rule.title}`);
  console.log(`Priority: ${rule.priority}`);
  console.log(`Examples: ${rule.examples.length}`);
}
```

#### `generateFromPatterns(patterns: Pattern[]): Promise<GeneratedRule>`

Generates a single rule from multiple related patterns (non-clustered).

---

## Planned MCP Tools (v2.3)

### Signal Management

#### `signal_add`

Add a custom signal to the dictionary.

**Input Schema**:
```json
{
  "text": "string (required)",
  "pattern_type": "string (required)",
  "polarity": "positive|negative|neutral",
  "confidence": "number (0-1)",
  "keywords": "comma-separated string",
  "source": "user_added"
}
```

**Example**:
```typescript
mcp__autoimprove-core__signal_add({
  text: "use === instead of == for strict equality",
  pattern_type: "anti-pattern",
  polarity: "negative",
  confidence: 0.9,
  keywords: "javascript,equality,comparison"
})
```

#### `signal_search`

Search signals in dictionary.

**Input Schema**:
```json
{
  "query": "string (text search)",
  "pattern_type": "string (optional filter)",
  "min_confidence": "number (optional, 0-1)",
  "language": "zh|en|mixed (optional)"
}
```

#### `signal_update_confidence`

Manually update signal confidence.

**Input Schema**:
```json
{
  "signal_id": "number (required)",
  "new_confidence": "number (0-1, required)",
  "reason": "string (required)",
  "evidence": "JSON object (optional)"
}
```

#### `signal_get_stats`

Get signal dictionary statistics.

**Returns**:
```json
{
  "total_signals": 523,
  "by_source": {
    "seed": 500,
    "llm_extracted": 20,
    "user_added": 3
  },
  "by_pattern_type": {
    "performance": 120,
    "security": 95,
    "correction": 200,
    "anti-pattern": 80,
    "preference": 28
  },
  "avg_confidence": 0.72,
  "total_matches": 15234,
  "avg_precision": 0.83
}
```

---

### Extraction Tools

#### `extract_signals_from_session`

Extract new signals from a specific session.

**Input Schema**:
```json
{
  "session_file_path": "string (required)",
  "force_extraction": "boolean (default: false)",
  "min_match_rate": "number (0-1, default: 0.4)"
}
```

**Returns**:
```json
{
  "extracted_signals": 8,
  "added_to_dictionary": 5,
  "rejected_low_quality": 3,
  "token_cost": 2100
}
```

#### `extract_signals_batch`

Extract signals from multiple sessions.

**Input Schema**:
```json
{
  "session_file_paths": ["string array (required)"],
  "max_sessions": "number (default: 10)",
  "parallel": "boolean (default: false)"
}
```

---

### Clustering Tools

#### `cluster_patterns`

Cluster patterns from recent sessions.

**Input Schema**:
```json
{
  "source": "recent_sessions|all_sessions|pattern_ids",
  "pattern_ids": "comma-separated IDs (if source=pattern_ids)",
  "similarity_threshold": "number (0-1, default: 0.75)",
  "max_clusters": "number (optional)"
}
```

**Returns**:
```json
{
  "total_patterns": 150,
  "total_clusters": 45,
  "reduction_rate": 70,
  "clusters": [...]
}
```

#### `generate_rules_from_clusters`

Generate rules from clustered patterns using LLM.

**Input Schema**:
```json
{
  "cluster_ids": "comma-separated cluster IDs",
  "min_cluster_size": "number (default: 2)",
  "use_llm": "boolean (default: true)"
}
```

---

### Bayesian Tools

#### `bayesian_update_signal`

Manually trigger Bayesian update for a signal.

**Input Schema**:
```json
{
  "signal_id": "number (required)",
  "feedback": {
    "outcome": "true_positive|false_positive|uncertain",
    "user_rating": "number (1-5, optional)",
    "context": "string (optional)"
  }
}
```

#### `bayesian_batch_update`

Batch update multiple signals based on recent feedback.

**Input Schema**:
```json
{
  "days": "number (default: 7, process feedback from last N days)",
  "min_matches": "number (default: 5, only update signals with enough data)"
}
```

**Returns**:
```json
{
  "updated_signals": 45,
  "avg_confidence_change": 0.05,
  "signals_pruned": 3
}
```

#### `bayesian_apply_time_decay`

Apply time decay to all signals.

**Input Schema**:
```json
{
  "decay_constant_days": "number (default: 90)",
  "min_confidence_threshold": "number (default: 0.3, prune below this)"
}
```

---

## Integration Guide

### 1. Basic Integration (Automatic)

Enable adaptive learning in config:

```json
// ~/.autoimprove/config.json
{
  "adaptive_learning": {
    "enable_signal_extraction": true,
    "extraction_threshold": 0.4,
    "min_unmatched_count": 10
  }
}
```

Adaptive features automatically activate in `analyze_session`.

### 2. Manual Signal Management

```typescript
// Add custom signal
const db = new SignalDictionaryDB();
db.addSignal({
  text: "avoid inline styles, use CSS classes",
  language: "en",
  pattern_type: "preference",
  polarity: "negative",
  confidence: 0.7,
  typical_context: ["react", "css", "styling"],
  related_signals: ["styled-components", "CSS modules"],
  source: "user_added"
});

// Update confidence after feedback
const signal = db.getSignal(signalId);
const updater = new BayesianConfidenceUpdater();
const newConf = updater.comprehensiveUpdate(signal, {
  outcome: "true_positive",
  user_rating: 5
});
db.updateConfidence(signalId, newConf, "feedback", {});
```

### 3. Clustering Workflow

```typescript
// Analyze session
const analyzer = new AdaptiveSessionAnalyzer();
const result = analyzer.analyzeSession(sessionFile, {
  enableClustering: true
});

// Generate rules from clusters
const generator = new LLMRuleGenerator();
const rules = await generator.generateFromClusters(result.clustering.clusters);

// Save rules
const indexManager = new RuleIndexManager();
for (const rule of rules) {
  indexManager.addRule(rule);
}
```

### 4. Performance Monitoring

```typescript
// Get signal statistics
const stats = db.getStatistics();
console.log(`Total signals: ${stats.total_signals}`);
console.log(`Avg precision: ${stats.avg_precision}`);

// Identify low-performing signals
const updater = new BayesianConfidenceUpdater();
const candidates = updater.identifyPruningCandidates(0.2, 10);
console.log(`Signals to review: ${candidates.length}`);

// Apply time decay
for (const signal of db.getAllSignals()) {
  const daysSince = calculateDaysSince(signal.last_seen);
  if (daysSince > 90) {
    const newConf = updater.applyTimeDecay(signal, daysSince);
    db.updateConfidence(signal.id, newConf, "time_decay", {});
  }
}
```

### 5. Cost Optimization

**Strategy 1**: Adjust extraction threshold
```json
{
  "extraction_threshold": 0.3  // Extract sooner (more cost, better coverage)
  // vs
  "extraction_threshold": 0.5  // Extract later (less cost, miss some patterns)
}
```

**Strategy 2**: Batch processing
```typescript
// Extract from multiple sessions in one batch
const unmatchedMessages = sessions.flatMap(s => s.unmatchedMessages);
const result = await extractor.extractSignals(unmatchedMessages);
// Cost: 1 batch vs. N separate calls
```

**Strategy 3**: Disable clustering for small pattern sets
```typescript
const options = {
  enableClustering: patterns.length > 100  // Only cluster if worth the cost
};
```

---

## Error Handling

### Common Errors

**`SignalDictionaryNotInitialized`**:
```
Error: Signal dictionary database not found
Solution: Run ./setup.sh --init-signals
```

**`LLMExtractionFailed`**:
```
Error: LLM API call failed (rate limit / auth)
Solution: Check API keys, retry with exponential backoff
```

**`ClusteringTimeout`**:
```
Error: Clustering took > 30s for 5000 patterns
Solution: Reduce pattern count or increase timeout
```

### Error Recovery

```typescript
try {
  const result = await extractor.extractSignals(messages);
} catch (error) {
  if (error.code === "RATE_LIMIT") {
    // Retry after delay
    await sleep(error.retryAfter * 1000);
    result = await extractor.extractSignals(messages);
  } else if (error.code === "INVALID_RESPONSE") {
    // Fall back to non-LLM extraction
    result = basicPatternExtraction(messages);
  } else {
    throw error;  // Unrecoverable
  }
}
```

---

## Performance Tuning

### Benchmarks

**Signal Matching** (500 signals, 1000 messages):
- Cold start (build automaton): 50ms
- Matching: 80ms (12,500 msg/s)
- Memory: 5MB

**LLM Extraction** (700 unmatched messages):
- Batch size 20: 35 batches × 3s = 105s
- Token cost: 35 × 2K = 70K tokens ≈ $1.40
- Throughput: 6.7 msg/s

**Bayesian Update** (1000 signals):
- Comprehensive update: 1.2ms/signal
- Total: 1.2s
- Memory: 2MB

**Clustering** (500 patterns):
- Feature extraction: 200ms
- Similarity calculation: 500ms
- Clustering: 100ms
- Total: 800ms

### Optimization Tips

1. **Increase batch size** for LLM extraction (up to 30 messages)
2. **Cache automaton** - rebuild only when signals change
3. **Parallel extraction** - process multiple batches concurrently
4. **Lazy clustering** - only cluster when pattern count > threshold
5. **Incremental updates** - only update changed signals

---

## Version History

**v2.2.0** (Current):
- Initial adaptive system implementation
- Signal dictionary with 500 seed signals
- LLM extraction and Bayesian updates
- Pattern clustering

**v2.3.0** (Planned):
- MCP tools for signal management
- Extraction and clustering tools
- Bayesian update tools
- Performance dashboard

**v3.0.0** (Future):
- Multi-project signal sharing
- Collaborative signal dictionary
- Advanced clustering algorithms (HDBSCAN)
- Real-time pattern detection
