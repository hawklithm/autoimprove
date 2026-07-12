/**
 * EmbeddingEncoder — CPU-only semantic representation for local ML enhancement.
 *
 * Default backend: "char-ngram-tfidf" — multilingual character n-gram TF-IDF.
 *   - No tokenizer needed; works for Chinese (no word segmentation) and mixed
 *     zh/en text via shared n-gram feature space.
 *   - Zero external dependencies, pure TS, runs fully on CPU.
 * Optional backend: "onnx-local" (P4) — quantized ONNX model via onnxruntime-node.
 *
 * Vectors are L2-normalized so cosine similarity == dot product.
 */

export type EmbeddingBackend = "char-ngram-tfidf" | "onnx-local";

export interface EmbeddingEncoderConfig {
  backend: EmbeddingBackend;
  ngramMin?: number;
  ngramMax?: number;
  hashDim?: number; // fixed output dim via hashing trick (default 2048)
  onnxModel?: string;
}

// Stop characters removed before n-gram extraction (punctuation/whitespace).
const NOISE_CHARS = /[\s\p{P}\p{S}]/gu;

export class EmbeddingEncoder {
  readonly backend: EmbeddingBackend;
  readonly version = 1; // bump when representation changes to invalidate caches
  private readonly ngramMin: number;
  private readonly ngramMax: number;
  // Fixed output dimension via hashing trick, so vectors are always alignable
  // across calls/batches (required for cosine). Avoids a global vocabulary.
  private readonly dim: number;

  // IDF state, populated lazily on first batch (inverse document frequency).
  private idf: Map<string, number> = new Map();
  private numDocsSeen = 0;
  private df: Map<string, number> = new Map();

  constructor(cfg: EmbeddingEncoderConfig) {
    this.backend = cfg.backend;
    this.ngramMin = cfg.ngramMin ?? 2;
    this.ngramMax = cfg.ngramMax ?? 3;
    this.dim = cfg.hashDim ?? 2048;
  }

  /** Encode a single text (uses current IDF state; call encodeBatch first for full-corpus IDF). */
  encode(text: string): Float32Array {
    return this.vectorize(this.toNgrams(text));
  }

  /** Encode a batch and update IDF statistics from the full batch. */
  encodeBatch(texts: string[]): Float32Array[] {
    this.df.clear();
    this.numDocsSeen = texts.length;
    const gramsPerDoc: string[][] = texts.map(t => this.toNgrams(t));

    for (const grams of gramsPerDoc) {
      const uniq = new Set(grams);
      for (const g of uniq) this.df.set(g, (this.df.get(g) || 0) + 1);
    }

    this.idf.clear();
    for (const [g, d] of this.df) {
      this.idf.set(g, Math.log((this.numDocsSeen + 1) / (d + 1)) + 1);
    }

    return gramsPerDoc.map(grams => this.vectorize(grams));
  }

  /** Cosine similarity between two already-normalized vectors (== dot product). */
  static cosine(a: Float32Array, b: Float32Array): number {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    for (let i = 0; i < n; i++) dot += a[i] * b[i];
    return dot;
  }

  // ----- internals -----

  /** Stable hash of an n-gram string into [0, dim). */
  private hashTerm(term: string): number {
    let h = 2166136261;
    for (let i = 0; i < term.length; i++) {
      h ^= term.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % this.dim;
  }

  private vectorize(grams: string[]): Float32Array {
    const tf = new Map<string, number>();
    for (const g of grams) tf.set(g, (tf.get(g) || 0) + 1);

    const vec = new Float32Array(this.dim);
    let norm = 0;
    for (const [g, f] of tf) {
      const idf = this.idf.get(g) ?? 1; // unseen n-gram -> idf 1
      const v = f * idf;
      vec[this.hashTerm(g)] += v;
      norm += v * v;
    }

    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < this.dim; i++) vec[i] /= norm;
    return vec;
  }

  private toNgrams(text: string): string[] {
    const cleaned = (text || "").toLowerCase().replace(NOISE_CHARS, "");
    if (cleaned.length === 0) return [];
    const grams: string[] = [];
    for (let n = this.ngramMin; n <= this.ngramMax; n++) {
      if (cleaned.length < n) {
        if (n === this.ngramMin) grams.push(cleaned); // very short text: keep as-is
        continue;
      }
      for (let i = 0; i + n <= cleaned.length; i++) {
        grams.push(cleaned.substring(i, i + n));
      }
    }
    return grams;
  }
}
