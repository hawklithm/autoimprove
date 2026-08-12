/**
 * Storage initialization and utilities.
 */

import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";

// ============================================================================
// Constants
// ============================================================================

function getStorageRoot(): string {
  // Allow overriding for tests
  if (process.env.AUTOIMPROVE_STORAGE_ROOT) {
    return process.env.AUTOIMPROVE_STORAGE_ROOT;
  }
  return join(homedir(), ".autoimprove");
}

export const STORAGE_ROOT = getStorageRoot();
export const RULES_DIR = join(STORAGE_ROOT, "rules");
export const RULES_INDEX_PATH = join(RULES_DIR, "index.json");
export const RULES_CONTENT_DIR = join(RULES_DIR, "content");
export const SESSIONS_DIR = join(STORAGE_ROOT, "sessions");
export const CACHE_DIR = join(STORAGE_ROOT, "cache");
export const CONFIG_PATH = join(STORAGE_ROOT, "config.json");
export const LOG_DIR = join(STORAGE_ROOT, "logs");

// ============================================================================
// Default Configuration
// ============================================================================

export interface Config {
  version: string;
  confidence_thresholds: {
    "repeated-correction": number;
    "anti-pattern": number;
    preference: number;
    performance: number;
    security: number;
  };
  confidence_weights: {
    frequency: number;
    time_span: number;
    behavior: number;
    validation: number;
  };
  rule_matching: {
    max_results: number;
    min_confidence: number;
  };
  business_domain_mappings: Record<string, string>;
  /** Phase 1 / P0+P1: Pattern Detection content filtering. */
  pattern_detection?: {
    /** Reject non-coding (business-dominant) patterns before they become rules. */
    enable_content_filter?: boolean;
    /** Use the optional LLM semantic classifier when the heuristic is uncertain. */
    use_llm_classification?: boolean;
  };
  rule_generation?: {
    use_template_generation?: boolean; // Enable SOP-style template compiler (Phase 2)
    template_hot_reload?: boolean;      // Watch templates for changes (dev mode)
    /** Phase 3 / P0: hold generated rules for manual review instead of auto-persisting. */
    require_manual_review_for?: {
      empty_scene?: boolean;       // block rules whose scenes are all empty
      low_quality_score?: number;  // block rules below this unified quality score
    };
    /** Phase 3 / P0: where the review queue jsonl is stored. */
    review_queue?: {
      path?: string;
    };
  };
  local_ml?: {
    enabled: boolean;
    embedding_backend: "char-ngram-tfidf" | "onnx-local";
    onnx_model?: string;
    prefilter: {
      enabled: boolean;
      mode: "heuristic" | "haiku" | "local-llm";
    };
    clusterer: "legacy" | "hdbscan" | "kmeans";
    pattern_clusterer?: "legacy" | "semantic"; // PatternClusterer (PatternSimilarityClusterer) semantic mode; defaults to "semantic" when clusterer != "legacy"
    signal_match: {
      mode: "legacy" | "neighbor";
      threshold: number;
    };
    personalization: {
      enabled: boolean;
      per_user: boolean;
    };
    ab_test?: {
      rollout: number; // 0..1 fraction of sessions routed to new pipeline
    };
  };
  write_gate?: {
    min_cross_session_for_experience: number; // 经验类跨会话复发阈值才成候选
    fact_becomes_rule: boolean;               // fact 是否成规则（默认 false）
    episodic_persist: boolean;                // 是否落库一次性 episodic（默认 false）
  };
}

const DEFAULT_CONFIG: Config = {
  version: "1.0",
  confidence_thresholds: {
    "repeated-correction": 0.45,
    "anti-pattern": 0.45,
    preference: 0.3,
    performance: 0.4,
    security: 0.3
  },
  confidence_weights: {
    frequency: 0.3,
    time_span: 0.1,
    behavior: 0.4,
    validation: 0.2
  },
  rule_matching: {
    max_results: 10,
    min_confidence: 0.3
  },
  business_domain_mappings: {},
  pattern_detection: {
    enable_content_filter: true,   // P0: block business-dominant patterns by default
    use_llm_classification: false, // P1: opt-in LLM semantic classification
  },
  rule_generation: {
    use_template_generation: true,  // Enable SOP-style template compiler by default
    template_hot_reload: true,      // Enable hot reload in development mode
    require_manual_review_for: {
      empty_scene: true,        // P0: hold empty-scene rules for review
      low_quality_score: 0.5,   // P0: hold low-quality rules for review
    },
  },
  local_ml: {
    enabled: false, // Master switch: when false, entire local_ml pipeline is bypassed (legacy behavior)
    embedding_backend: "char-ngram-tfidf", // Default: zero-dependency char n-gram TF-IDF
    prefilter: {
      enabled: false, // P0 ships heuristic pre-filter, off by default
      mode: "heuristic",
    },
    clusterer: "legacy", // "legacy" = original word-level TF-IDF clustering (no behavior change)
    pattern_clusterer: "legacy", // PatternSimilarityClusterer: "legacy" = keyword/text overlap; flip to "semantic" with clusterer
    signal_match: {
      mode: "legacy", // "legacy" = original Aho-Corasick exact matching
      threshold: 0.62,
    },
    personalization: {
      enabled: false,
      per_user: false,
    },
    ab_test: {
      rollout: 0, // 0 = all traffic on legacy; gradually raise for A/B
    },
  },
  write_gate: {
    min_cross_session_for_experience: 2,
    fact_becomes_rule: false,
    episodic_persist: false,
  },
};

// ============================================================================
// Initialization
// ============================================================================

export function initStorage(): void {
  // Create directories
  const dirs = [
    STORAGE_ROOT,
    RULES_DIR,
    RULES_CONTENT_DIR,
    SESSIONS_DIR,
    CACHE_DIR,
    LOG_DIR
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Create default config if not exists
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }

  // Create empty index if not exists
  if (!existsSync(RULES_INDEX_PATH)) {
    writeFileSync(RULES_INDEX_PATH, JSON.stringify({ version: "1.0", rules: [] }, null, 2));
  }
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    initStorage();
  }

  const data = readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(data) as Config;
}

export function saveConfig(config: Config): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getStorageInfo() {
  const exists = existsSync(STORAGE_ROOT);

  if (!exists) {
    return {
      initialized: false,
      storage_root: STORAGE_ROOT
    };
  }

  const indexExists = existsSync(RULES_INDEX_PATH);
  const rulesCount = indexExists
    ? JSON.parse(readFileSync(RULES_INDEX_PATH, "utf-8")).rules.length
    : 0;

  return {
    initialized: true,
    storage_root: STORAGE_ROOT,
    rules_count: rulesCount,
    config: loadConfig()
  };
}
