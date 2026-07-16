/**
 * Personalizer — per-user online personalization for local_ml.
 *
 * Builds a "user style centroid" from that user's positive-signal vectors
 * (averaged), and derives per-user adaptive thresholds (matchThreshold for
 * NeighborSignalMatcher, SIMILARITY_THRESHOLD for MessageClusterer). Positive /
 * negative samples are fed incrementally (EMA) from recordFeedback /
 * mark_session_analyzed and persisted to:
 *   ~/.autoimprove/personalization/{user_id}.json
 * carrying the encoder `version` so stale centroids are invalidated.
 *
 * No new DB tables: raw signals are sourced from the existing signal_matches
 * (outcome) / confidence_history tables via SignalDictionaryDB; the centroid
 * and thresholds are the ONLY thing persisted here (lightweight JSON).
 */

import { EmbeddingEncoder } from "./embedding-encoder.js";
import { loadConfig } from "../storage/init.js";
import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export interface UserProfile {
  user_id: string;
  encoder_version: number;
  centroid: number[];          // L2-normalized user style centroid
  matchThreshold: number;      // adaptive threshold for signal matching
  similarityThreshold: number; // adaptive threshold for message clustering
  positive_count: number;
  negative_count: number;
  last_updated: string;
}

const DEFAULT_MATCH_THRESHOLD = 0.62;
const DEFAULT_SIMILARITY_THRESHOLD = 0.25;
const EMA_ALPHA = 0.1; // exponential moving average factor

export class Personalizer {
  private encoder: EmbeddingEncoder;
  private dir: string;
  private cache = new Map<string, UserProfile>();

  constructor() {
    const cfg = loadConfig().local_ml;
    this.encoder = new EmbeddingEncoder({
      backend: (cfg?.embedding_backend as any) || "char-ngram-tfidf",
    });
    this.dir = join(
      process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove"),
      "personalization"
    );
  }

  private storageRoot(): string {
    return this.dir;
  }

  private enabled(): boolean {
    return loadConfig().local_ml?.personalization?.enabled === true;
  }

  private filePath(userId: string): string {
    const safe = userId.replace(/[^a-zA-Z0-9_\-]/g, "_");
    return join(this.storageRoot(), `${safe}.json`);
  }

  /**
   * Load a user profile from disk (or create a default one).
   */
  private load(userId: string): UserProfile {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const path = this.filePath(userId);
    let profile: UserProfile;
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf-8")) as UserProfile;
        // Invalidate centroid if encoder changed.
        if (parsed.encoder_version !== this.encoder.version) {
          parsed.centroid = [];
          parsed.encoder_version = this.encoder.version;
        }
        profile = parsed;
      } catch {
        profile = this.defaultProfile(userId);
      }
    } else {
      profile = this.defaultProfile(userId);
    }
    this.cache.set(userId, profile);
    return profile;
  }

  private defaultProfile(userId: string): UserProfile {
    return {
      user_id: userId,
      encoder_version: this.encoder.version,
      centroid: [],
      matchThreshold: DEFAULT_MATCH_THRESHOLD,
      similarityThreshold: DEFAULT_SIMILARITY_THRESHOLD,
      positive_count: 0,
      negative_count: 0,
      last_updated: new Date().toISOString(),
    };
  }

  private save(profile: UserProfile): void {
    if (!existsSync(this.storageRoot())) {
      mkdirSync(this.storageRoot(), { recursive: true });
    }
    profile.last_updated = new Date().toISOString();
    this.cache.set(profile.user_id, profile);
    writeFileSync(this.filePath(profile.user_id), JSON.stringify(profile, null, 2));
  }

  /**
   * Record a feedback event: associate feedback_type with a signal text and
   * update the user centroid / thresholds (EMA). No-op when personalization
   * is disabled (legacy behavior preserved).
   */
  async recordFeedback(
    userId: string,
    feedbackType: "used" | "ignored" | "corrected" | "disabled",
    signalText?: string
  ): Promise<void> {
    if (!this.enabled()) return;

    const profile = this.load(userId);
    const positive = feedbackType === "used" || feedbackType === "corrected";
    const negative = feedbackType === "ignored" || feedbackType === "disabled";

    if (signalText && (positive || negative)) {
      const vec = await this.encoder.encode(signalText);
      // EMA update of centroid with the (signed) sample.
      const sign = positive ? 1 : -1;
      if (profile.centroid.length === 0) {
        profile.centroid = Array.from(vec).map(v => v * sign);
      } else {
        for (let i = 0; i < vec.length; i++) {
          profile.centroid[i] += EMA_ALPHA * (vec[i] * sign - profile.centroid[i]);
        }
      }
      profile.positive_count += positive ? 1 : 0;
      profile.negative_count += negative ? 1 : 0;

      // Re-normalize centroid.
      const norm = Math.sqrt(profile.centroid.reduce((s, v) => s + v * v, 0)) || 1;
      profile.centroid = profile.centroid.map(v => v / norm);

      // Adaptive thresholds: more positives → tighten (raise) threshold to be
      // more selective; more negatives → loosen (lower) to avoid over-matching.
      const total = profile.positive_count + profile.negative_count;
      const posRatio = total > 0 ? profile.positive_count / total : 0.5;
      profile.matchThreshold = DEFAULT_MATCH_THRESHOLD + (posRatio - 0.5) * 0.2;
      profile.similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD + (posRatio - 0.5) * 0.1;
    }

    this.save(profile);
  }

  /**
   * After a session is analyzed, fold the session's positive signals into the
   * user centroid (async-safe; called incrementally).
   */
  async recordSessionAnalyzed(userId: string, positiveSignalTexts: string[]): Promise<void> {
    if (!this.enabled() || positiveSignalTexts.length === 0) return;
    const profile = this.load(userId);

    for (const text of positiveSignalTexts) {
      const vec = await this.encoder.encode(text);
      if (profile.centroid.length === 0) {
        profile.centroid = Array.from(vec);
      } else {
        for (let i = 0; i < vec.length; i++) {
          profile.centroid[i] += EMA_ALPHA * (vec[i] - profile.centroid[i]);
        }
      }
      profile.positive_count += 1;
    }
    const norm = Math.sqrt(profile.centroid.reduce((s, v) => s + v * v, 0)) || 1;
    profile.centroid = profile.centroid.map(v => v / norm);

    const total = profile.positive_count + profile.negative_count;
    const posRatio = total > 0 ? profile.positive_count / total : 0.5;
    profile.matchThreshold = DEFAULT_MATCH_THRESHOLD + (posRatio - 0.5) * 0.2;
    profile.similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD + (posRatio - 0.5) * 0.1;

    this.save(profile);
  }

  /**
   * Get the adaptive match threshold for a user (fallback to default).
   */
  getMatchThreshold(userId: string): number {
    if (!this.enabled()) return DEFAULT_MATCH_THRESHOLD;
    return this.load(userId).matchThreshold;
  }

  /**
   * Get the adaptive similarity threshold for a user (fallback to default).
   */
  getSimilarityThreshold(userId: string): number {
    if (!this.enabled()) return DEFAULT_SIMILARITY_THRESHOLD;
    return this.load(userId).similarityThreshold;
  }

  /**
   * Cosine between a message vector and the user centroid (for an optional
   * nearest-centroid classifier: "is this message worth extracting as signal?").
   */
  async centroidSimilarity(userId: string, text: string): Promise<number> {
    const profile = this.load(userId);
    if (profile.centroid.length === 0) return 0;
    const vec = await this.encoder.encode(text);
    let dot = 0;
    for (let i = 0; i < vec.length; i++) dot += vec[i] * profile.centroid[i];
    return dot;
  }
}
