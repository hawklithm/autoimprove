/**
 * [P2-1] Memory similarity: embedding cosine + lexical Jaccard.
 *
 * Replaces the pure-Jaccard word-set overlap that `MemoryConsolidator` used
 * to decide whether two memories say the same thing. Jaccard cannot see
 * "same experience, different wording", so paraphrased memories piled up as
 * duplicates.
 *
 * ── Threshold calibration (src/scripts/calibrate-consolidator-similarity.ts,
 *    backend=char-ngram-tfidf, 14 labelled pairs, zh + en) ──────────────────
 *
 *   label        cosine (min–max)   jaccard (min–max)
 *   same         0.919 – 1.000      0.500 – 1.000
 *   paraphrase   0.287 – 0.583      0.000 – 0.364
 *   related      0.400 – 0.843      0.000 – 0.714
 *   unrelated    0.000 – 0.110      0.000 – 0.000
 *
 * Two things follow from that distribution:
 *
 * 1. MERGE_THRESHOLD = 0.90 sits in the clean gap between `same` (min 0.919)
 *    and `related` (max 0.843). Anything at/above it is genuinely the same
 *    statement, so merging evidence is safe.
 *
 * 2. `related` OUTSCORES `paraphrase` on this backend ("run build before
 *    committing" vs "run test before committing" = 0.843, while a true
 *    paraphrase can be 0.287). char-ngram-tfidf measures fuzzy *lexical*
 *    overlap, not meaning. So a match above MATCH_THRESHOLD must NOT be
 *    treated as "these are interchangeable" — it only means "same topic,
 *    worth comparing". The actual merge/supersede/co-exist call is made by
 *    the consolidator's explicit three-branch logic (see [P2-2]), never by
 *    the raw score alone.
 *
 * Scores are combined with `max(lexical, semantic)` so every pair that the
 * old Jaccard implementation merged still merges (no recall regression),
 * while paraphrases that Jaccard scored at 0 can now be caught.
 */
import { EmbeddingEncoder } from "./embedding-encoder.js";
import { MemoryRecord } from "./memory-models.js";

/** ≥ this ⇒ the two memories state the same thing; merge evidence (UPDATE). */
export const MERGE_THRESHOLD = 0.9;

/** ≥ this ⇒ same topic; worth running the three-branch decision against. */
export const MATCH_THRESHOLD = 0.55;

export interface SimilarityBreakdown {
  /** Combined score used for thresholding, clamped to [0, 1]. */
  score: number;
  /** Embedding cosine (fuzzy-lexical on char-ngram, semantic on ONNX). */
  semantic: number;
  /** Word-set Jaccard overlap — the pre-P2-1 signal, kept as a floor. */
  lexical: number;
}

function tokenize(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^\p{L}\p{N}_+#.-]+/u).filter(Boolean));
}

/** Word-set Jaccard overlap between two token bags. */
export function jaccardSimilarity(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 && right.size === 0) return 0;
  const intersection = [...left].filter(token => right.has(token)).length;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
}

/**
 * Computes memory-to-memory similarity with a per-record vector cache.
 *
 * `consolidate()` compares one candidate against every active memory, so
 * without caching we would re-encode the whole store on every write.
 */
export class MemorySimilarity {
  private readonly encoder: EmbeddingEncoder;
  private readonly cache = new Map<string, Float32Array>();
  private readonly maxCacheEntries: number;

  constructor(encoder?: EmbeddingEncoder, maxCacheEntries = 2000) {
    // Always char-ngram-tfidf: consolidate() is synchronous and ONNX
    // inference is not. See EmbeddingEncoder.encodeSync().
    this.encoder = encoder || new EmbeddingEncoder({ backend: "char-ngram-tfidf" });
    this.maxCacheEntries = maxCacheEntries;
  }

  /**
   * Text used for scoring: `content` only.
   *
   * The pre-P2-1 Jaccard mixed in `keywords` and `kind`. Those are largely
   * boilerplate — two memories from the same analyzer run routinely carry an
   * identical keyword list — which dragged every score upward and pushed
   * genuinely different statements past the merge threshold. The calibration
   * table above was measured on content alone, so scoring must match it.
   */
  private textOf(memory: MemoryRecord): string {
    return (memory.content || "").trim();
  }

  private vectorOf(memory: MemoryRecord): Float32Array {
    // Keyed by the encoded text, not by memory id. An id-based key goes stale
    // the moment a record's content is edited, and would hand back another
    // record's vector entirely whenever ids are reused.
    const text = this.textOf(memory);
    const key = cacheKey(text);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const vector = this.encoder.encodeSync(text);
    if (this.cache.size >= this.maxCacheEntries) {
      // Cheap FIFO eviction; ordering is insertion order for Map.
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, vector);
    return vector;
  }

  compare(a: MemoryRecord, b: MemoryRecord): SimilarityBreakdown {
    // Hash collisions in the 2048-dim hashed space mean the stored norm is
    // computed pre-collision, so cosine can drift slightly above 1.0.
    const semantic = clamp01(EmbeddingEncoder.cosine(this.vectorOf(a), this.vectorOf(b)));
    const lexical = jaccardSimilarity(this.textOf(a), this.textOf(b));
    return { score: Math.max(semantic, lexical), semantic, lexical };
  }

  score(a: MemoryRecord, b: MemoryRecord): number {
    return this.compare(a, b).score;
  }

  /** Drop cached vectors (tests, or after a bulk store rewrite). */
  clearCache(): void {
    this.cache.clear();
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** FNV-1a digest plus length, compact enough to use as a Map key. */
function cacheKey(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}
