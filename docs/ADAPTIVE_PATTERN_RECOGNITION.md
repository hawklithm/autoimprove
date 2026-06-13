# Adaptive Pattern Recognition System Design

## Overview

Replace simple keyword matching with a self-learning signal dictionary system that improves over time.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Session Messages                             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
          ┌──────────────────────┐
          │  Signal Matcher      │
          │  (Dictionary-based)  │
          └──────┬───────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
   ┌─────────┐      ┌──────────────┐
   │ Matched │      │  Unmatched   │
   │ Content │      │   Content    │
   └────┬────┘      └──────┬───────┘
        │                  │
        │                  ▼
        │           ┌─────────────────┐
        │           │  LLM Extractor  │
        │           │ (Extract Signals)│
        │           └────────┬─────────┘
        │                    │
        │                    ▼
        │           ┌──────────────────┐
        │           │  New Signals +   │
        │           │  Confidence      │
        │           └────────┬─────────┘
        │                    │
        ▼                    ▼
   ┌────────────────────────────────┐
   │   Confidence Updater           │
   │   (Bayesian Update Algorithm)  │
   └────────────┬───────────────────┘
                │
                ▼
   ┌────────────────────────────┐
   │  Signal Dictionary         │
   │  (Persistent Storage)      │
   └────────────┬───────────────┘
                │
                ▼
   ┌────────────────────────────┐
   │  Labeled Content           │
   │  {pattern_type, signals}   │
   └────────────┬───────────────┘
                │
                ▼
   ┌────────────────────────────┐
   │  Pattern Clusterer         │
   │  (Group by similarity)     │
   └────────────┬───────────────┘
                │
                ▼
   ┌────────────────────────────┐
   │  Rule Generator (LLM)      │
   │  (Summarize → Rules)       │
   └────────────┬───────────────┘
                │
                ▼
   ┌────────────────────────────┐
   │  Scene Tagger (LLM)        │
   │  {tech, business, generic} │
   └────────────────────────────┘
```

## Data Structures

### 1. Signal Dictionary

```typescript
interface SignalDictionary {
  version: string;
  signals: SignalEntry[];
  metadata: {
    total_sessions_processed: number;
    last_updated: string;
    total_signals: number;
  };
}

interface SignalEntry {
  // Core fields
  text: string;                    // "改成", "不对", "should use"
  language: "zh" | "en" | "mixed"; // Language of signal
  
  // Pattern classification
  pattern_type: "correction" | "anti-pattern" | "preference" | "performance" | "security";
  polarity: "positive" | "negative"; // Positive = good practice, Negative = mistake
  
  // Confidence tracking
  confidence: number;              // Current confidence (0-1)
  confidence_history: ConfidenceUpdate[];
  
  // Usage statistics
  match_count: number;             // How many times matched
  true_positive: number;           // User confirmed as valid
  false_positive: number;          // User rejected as invalid
  
  // Context
  typical_context: string[];       // Common phrases around this signal
  related_signals: string[];       // Other signals often appearing together
  
  // Metadata
  first_seen: string;
  last_seen: string;
  source: "seed" | "llm_extracted" | "user_added";
}

interface ConfidenceUpdate {
  timestamp: string;
  old_confidence: number;
  new_confidence: number;
  reason: "bayesian_update" | "feedback" | "co_occurrence" | "time_decay";
  evidence: {
    true_positives?: number;
    false_positives?: number;
    context_match?: number;
  };
}
```

### 2. Labeled Content

```typescript
interface LabeledContent {
  message_id: string;
  session_id: string;
  content: string;
  
  // Signal matching results
  matched_signals: MatchedSignal[];
  pattern_type: PatternType;
  confidence: number;              // Aggregated from signals
  
  // Context
  before_content?: string;         // Previous message
  after_content?: string;          // Next message
  related_tool_calls?: string[];   // Tool calls around this message
  
  // Metadata
  labeled_at: string;
  labeling_method: "dictionary" | "llm";
}

interface MatchedSignal {
  signal_text: string;
  position: number;                // Position in content
  context_window: string;          // Surrounding text
  confidence: number;              // Signal's current confidence
  contribution_weight: number;     // How much this signal contributes to label
}
```

### 3. Pattern Cluster

```typescript
interface PatternCluster {
  cluster_id: string;
  pattern_type: PatternType;
  
  // Content
  labeled_contents: string[];      // IDs of labeled content
  common_signals: string[];        // Signals shared across content
  
  // Semantic
  representative_phrases: string[];
  semantic_embedding?: number[];   // For similarity calculation
  
  // Statistics
  total_occurrences: number;
  session_count: number;
  avg_confidence: number;
}
```

### 4. Generated Rule

```typescript
interface GeneratedRule {
  id: string;
  
  // Core content
  title: string;
  description: string;             // What to do / not to do
  rationale: string;               // Why this rule exists
  
  // Source tracking
  source_cluster_id: string;
  source_signals: string[];
  source_sessions: string[];
  evidence_count: number;
  
  // Scene tagging
  scenes: {
    tech: string[];                // ["react", "typescript"]
    business: string[];            // ["e-commerce", "payment"]
    generic: boolean;              // True if applies broadly
  };
  
  // Quality
  confidence: number;
  priority: "critical" | "high" | "medium" | "low";
  
  // Metadata
  created_at: string;
  last_validated: string;
}
```

## Algorithm Design

### 1. Confidence Update Algorithm (Bayesian)

```typescript
class BayesianConfidenceUpdater {
  /**
   * Update signal confidence using Bayesian inference
   * 
   * Prior: Current confidence
   * Likelihood: Match outcome (true positive / false positive)
   * Posterior: Updated confidence
   */
  updateConfidence(
    signal: SignalEntry,
    outcome: "true_positive" | "false_positive" | "uncertain"
  ): number {
    const prior = signal.confidence;
    
    // Calculate likelihood based on outcome
    let likelihood: number;
    if (outcome === "true_positive") {
      likelihood = 0.9; // Strong positive evidence
    } else if (outcome === "false_positive") {
      likelihood = 0.1; // Strong negative evidence
    } else {
      likelihood = 0.5; // Neutral
    }
    
    // Bayesian update: P(H|E) = P(E|H) * P(H) / P(E)
    // Simplified using weighted average with decay
    const learningRate = 0.1; // How quickly we adapt
    const posterior = prior * (1 - learningRate) + likelihood * learningRate;
    
    // Apply bounds [0.1, 0.95] to prevent extreme values
    return Math.max(0.1, Math.min(0.95, posterior));
  }
  
  /**
   * Update based on co-occurrence with high-confidence signals
   */
  updateByCoOccurrence(
    signal: SignalEntry,
    coOccurringSignals: SignalEntry[]
  ): number {
    // If this signal often appears with high-confidence signals,
    // boost its confidence
    const avgCoConfidence = coOccurringSignals.reduce(
      (sum, s) => sum + s.confidence,
      0
    ) / coOccurringSignals.length;
    
    // Weighted update
    const weight = 0.05; // Small weight for co-occurrence
    return signal.confidence * (1 - weight) + avgCoConfidence * weight;
  }
  
  /**
   * Time decay for signals that haven't been seen recently
   */
  applyTimeDecay(signal: SignalEntry, daysSinceLastSeen: number): number {
    if (daysSinceLastSeen < 30) {
      return signal.confidence; // No decay
    }
    
    // Decay formula: confidence * e^(-λt)
    const lambda = 0.01; // Decay rate
    const decayFactor = Math.exp(-lambda * daysSinceLastSeen);
    
    return signal.confidence * decayFactor;
  }
  
  /**
   * Multi-factor confidence update
   */
  comprehensiveUpdate(
    signal: SignalEntry,
    feedback: {
      outcome?: "true_positive" | "false_positive";
      coOccurring?: SignalEntry[];
      daysSinceLastSeen?: number;
    }
  ): number {
    let newConfidence = signal.confidence;
    
    // Apply each update factor
    if (feedback.outcome) {
      newConfidence = this.updateConfidence(signal, feedback.outcome);
    }
    
    if (feedback.coOccurring && feedback.coOccurring.length > 0) {
      newConfidence = this.updateByCoOccurrence(
        { ...signal, confidence: newConfidence },
        feedback.coOccurring
      );
    }
    
    if (feedback.daysSinceLastSeen !== undefined) {
      newConfidence = this.applyTimeDecay(
        { ...signal, confidence: newConfidence },
        feedback.daysSinceLastSeen
      );
    }
    
    return newConfidence;
  }
}
```

### 2. LLM Signal Extraction

```typescript
class LLMSignalExtractor {
  /**
   * Extract signals from unmatched content using LLM
   */
  async extractSignals(unmatchedContent: string[]): Promise<ExtractedSignal[]> {
    const prompt = `
You are analyzing chat messages to identify correction/preference signals.

Task: Extract signal words/phrases that indicate:
1. Corrections (user pointing out mistakes)
2. Preferences (user stating preferences)
3. Anti-patterns (user identifying bad approaches)
4. Performance issues
5. Security concerns

For each signal, provide:
- The exact signal text
- Pattern type (correction/preference/anti-pattern/performance/security)
- Polarity (positive = good practice, negative = mistake)
- Initial confidence (0.5-0.8 for new signals)
- Context (why this is a signal)

Messages to analyze:
${unmatchedContent.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Respond in JSON format:
{
  "signals": [
    {
      "text": "应该用",
      "pattern_type": "correction",
      "polarity": "positive",
      "confidence": 0.7,
      "context": "User suggesting better approach",
      "example_usage": "应该用 useState 而不是 useReducer"
    }
  ]
}
`;
    
    const response = await this.callLLM(prompt, { model: "claude-haiku" });
    return this.parseExtractedSignals(response);
  }
  
  /**
   * Validate extracted signals before adding to dictionary
   */
  validateSignal(signal: ExtractedSignal): boolean {
    // Check if signal is meaningful
    if (signal.text.length < 2) return false;
    if (signal.text.length > 50) return false;
    
    // Check if confidence is reasonable
    if (signal.confidence < 0.5 || signal.confidence > 0.8) return false;
    
    // Check for duplicates/near-duplicates in dictionary
    // ...
    
    return true;
  }
}
```

### 3. Pattern Clustering Algorithm

```typescript
class PatternClusterer {
  /**
   * Cluster labeled content by semantic similarity
   */
  async clusterPatterns(
    labeledContent: LabeledContent[]
  ): Promise<PatternCluster[]> {
    // Group by pattern type first
    const byType = this.groupByType(labeledContent);
    
    const clusters: PatternCluster[] = [];
    
    for (const [type, contents] of Object.entries(byType)) {
      // Extract features for clustering
      const features = contents.map(c => this.extractFeatures(c));
      
      // DBSCAN clustering or simple similarity-based grouping
      const typeClusters = await this.performClustering(features, contents);
      
      clusters.push(...typeClusters);
    }
    
    return clusters;
  }
  
  private extractFeatures(content: LabeledContent): ClusterFeatures {
    return {
      signals: content.matched_signals.map(s => s.signal_text),
      contentEmbedding: this.getEmbedding(content.content),
      confidence: content.confidence,
    };
  }
  
  /**
   * Simple similarity-based clustering
   */
  private async performClustering(
    features: ClusterFeatures[],
    contents: LabeledContent[]
  ): Promise<PatternCluster[]> {
    const clusters: PatternCluster[] = [];
    const visited = new Set<number>();
    
    for (let i = 0; i < features.length; i++) {
      if (visited.has(i)) continue;
      
      // Start new cluster
      const cluster: PatternCluster = {
        cluster_id: `cluster-${Date.now()}-${i}`,
        pattern_type: contents[i].pattern_type,
        labeled_contents: [contents[i].message_id],
        common_signals: [...features[i].signals],
        representative_phrases: [contents[i].content.slice(0, 100)],
        total_occurrences: 1,
        session_count: 1,
        avg_confidence: contents[i].confidence,
      };
      
      visited.add(i);
      
      // Find similar items
      for (let j = i + 1; j < features.length; j++) {
        if (visited.has(j)) continue;
        
        const similarity = this.calculateSimilarity(features[i], features[j]);
        
        if (similarity > 0.7) {
          // Add to cluster
          cluster.labeled_contents.push(contents[j].message_id);
          cluster.total_occurrences++;
          
          // Update common signals (intersection)
          cluster.common_signals = cluster.common_signals.filter(s =>
            features[j].signals.includes(s)
          );
          
          visited.add(j);
        }
      }
      
      clusters.push(cluster);
    }
    
    return clusters;
  }
  
  private calculateSimilarity(f1: ClusterFeatures, f2: ClusterFeatures): number {
    // Signal overlap
    const signalOverlap = this.jaccardSimilarity(f1.signals, f2.signals);
    
    // Embedding similarity (cosine)
    const embeddingSimilarity = this.cosineSimilarity(
      f1.contentEmbedding,
      f2.contentEmbedding
    );
    
    // Weighted combination
    return signalOverlap * 0.4 + embeddingSimilarity * 0.6;
  }
  
  private jaccardSimilarity(set1: string[], set2: string[]): number {
    const s1 = new Set(set1);
    const s2 = new Set(set2);
    
    const intersection = new Set([...s1].filter(x => s2.has(x)));
    const union = new Set([...s1, ...s2]);
    
    return intersection.size / union.size;
  }
}
```

### 4. Rule Generation from Clusters

```typescript
class LLMRuleGenerator {
  /**
   * Generate rule from pattern cluster using LLM
   */
  async generateRule(cluster: PatternCluster): Promise<GeneratedRule> {
    // Load full content for cluster
    const fullContents = await this.loadClusterContents(cluster);
    
    const prompt = `
You are creating a coding rule from observed patterns.

Pattern Type: ${cluster.pattern_type}
Occurrences: ${cluster.total_occurrences}
Common Signals: ${cluster.common_signals.join(', ')}

Example corrections/preferences:
${fullContents.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Generate a rule with:
1. **Title**: Short, actionable title (imperative form)
2. **Description**: What to do / what to avoid (clear, specific)
3. **Rationale**: Why this rule exists (benefits, risks avoided)
4. **Scene Tags**: 
   - tech: Which technologies does this apply to? (e.g., ["react", "typescript"])
   - business: Which business domains? (e.g., ["e-commerce", "authentication"])
   - generic: Is this a universal principle? (true/false)

Respond in JSON:
{
  "title": "Use useState for simple state management",
  "description": "For boolean or simple value state, use useState instead of useReducer. Reserve useReducer for complex state with multiple sub-values or state transitions.",
  "rationale": "useState is simpler and more readable for basic cases. Using useReducer adds unnecessary complexity and boilerplate for simple state.",
  "scenes": {
    "tech": ["react", "hooks"],
    "business": [],
    "generic": false
  }
}
`;
    
    const response = await this.callLLM(prompt, { model: "claude-sonnet" });
    const parsed = JSON.parse(response);
    
    return {
      id: `rule-${Date.now()}`,
      title: parsed.title,
      description: parsed.description,
      rationale: parsed.rationale,
      source_cluster_id: cluster.cluster_id,
      source_signals: cluster.common_signals,
      source_sessions: [], // Extract from cluster
      evidence_count: cluster.total_occurrences,
      scenes: parsed.scenes,
      confidence: cluster.avg_confidence,
      priority: this.determinePriority(cluster),
      created_at: new Date().toISOString(),
      last_validated: new Date().toISOString(),
    };
  }
  
  private determinePriority(cluster: PatternCluster): "critical" | "high" | "medium" | "low" {
    if (cluster.pattern_type === "security") return "critical";
    if (cluster.pattern_type === "anti-pattern") return "high";
    if (cluster.pattern_type === "performance") return "high";
    if (cluster.pattern_type === "correction" && cluster.total_occurrences >= 3) return "medium";
    return "low";
  }
}
```

## Implementation Phases

### Phase 1: Signal Dictionary Foundation (Week 1)
- [ ] Define signal dictionary schema
- [ ] Create seed dictionary with 50-100 signals (zh + en)
- [ ] Implement `SignalMatcher` class
- [ ] Implement `BayesianConfidenceUpdater` class
- [ ] Test on historical sessions

### Phase 2: LLM Signal Extraction (Week 2)
- [ ] Implement `LLMSignalExtractor` class
- [ ] Create prompt templates for signal extraction
- [ ] Validate extracted signals before adding
- [ ] Implement signal deduplication logic
- [ ] Test extraction quality

### Phase 3: Pattern Clustering (Week 3)
- [ ] Implement `PatternClusterer` class
- [ ] Choose clustering algorithm (DBSCAN or similarity-based)
- [ ] Implement feature extraction (signals + embeddings)
- [ ] Test clustering quality on sample data

### Phase 4: Rule Generation (Week 4)
- [ ] Implement `LLMRuleGenerator` class
- [ ] Create prompt templates for rule generation
- [ ] Implement scene tagging logic
- [ ] Integrate with existing rule storage
- [ ] End-to-end testing

### Phase 5: Integration & Optimization (Week 5)
- [ ] Replace old `SessionAnalyzer` pattern detection
- [ ] Add MCP tools for dictionary management
- [ ] Create `/autoimprove-train` skill for manual training
- [ ] Performance optimization (caching, batching)
- [ ] Documentation

## Storage Structure

```
~/.autoimprove/
├── signal_dictionary.json          # Main signal dictionary
├── signal_backups/                 # Daily backups
│   └── signal_dictionary_2024-01-01.json
├── labeled_content/
│   └── <session-id>.json          # Labeled content per session
├── pattern_clusters/
│   └── clusters_<date>.json       # Pattern clusters
└── training_data/
    ├── validated_signals.jsonl    # User-validated signals
    └── extraction_log.jsonl       # LLM extraction history
```

## Performance Considerations

1. **Signal Matching**: O(n*m) where n=content length, m=signals
   - Optimization: Use Aho-Corasick algorithm for multi-pattern matching
   - Expected: <10ms for 1000 signals on typical message

2. **LLM Extraction**: ~2-5s per batch of 10 messages
   - Batch unmatched content to reduce API calls
   - Use Haiku for cost efficiency ($0.25/million tokens)

3. **Clustering**: O(n²) for similarity-based
   - Limit to 100 items per clustering run
   - Use embeddings cache to avoid recomputation

4. **Dictionary Size**: Target 500-1000 signals
   - Periodic pruning of low-confidence signals (confidence < 0.3)
   - Merge near-duplicate signals

## Success Metrics

1. **Signal Coverage**: % of content matched by dictionary (target: >80%)
2. **Signal Accuracy**: True positive rate (target: >85%)
3. **Dictionary Growth**: New signals added per session (target: 2-5)
4. **Rule Quality**: User acceptance rate (target: >70%)
5. **Performance**: Total analysis time per session (target: <10s)
