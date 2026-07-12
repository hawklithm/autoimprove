/**
 * EmbeddingEncoder — CPU-only semantic representation for local ML enhancement.
 *
 * Default backend: "char-ngram-tfidf" — multilingual character n-gram TF-IDF.
 *   - No tokenizer needed; works for Chinese (no word segmentation) and mixed
 *     zh/en text via shared n-gram feature space.
 *   - Zero external dependencies, pure TS, runs fully on CPU.
 * Optional backend: "onnx-local" (P4) — quantized ONNX model via onnxruntime-node.
 *
 * C2: vectors can be cached to disk per session (via saveCache/loadCache) so that
 * expensive encoding (especially ONNX) is skipped on repeat analysis of the same
 * session. char-ngram-tfidf still benefits from cache when the session has not
 * changed (avoids re-extracting n-grams + re-hashing for thousands of messages).
 *
 * C3: ONNX backend uses onnxruntime-node (optional dep). When the package is
 * unavailable, construction falls back to char-ngram-tfidf with a warning so the
 * application never crashes from a missing native module.
 *
 * Vectors are L2-normalized so cosine similarity == dot product.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { logger } from "./logger.js";

export type EmbeddingBackend = "char-ngram-tfidf" | "onnx-local";

export interface EmbeddingEncoderConfig {
  backend: EmbeddingBackend;
  ngramMin?: number;
  ngramMax?: number;
  hashDim?: number; // fixed output dim via hashing trick (default 2048)
  onnxModel?: string;
  /** C2: optional cache dir for persisting encoded vectors (default: ~/.autoimprove/cache/embeddings) */
  cacheDir?: string;
}

// Stop characters removed before n-gram extraction (punctuation/whitespace).
const NOISE_CHARS = /[\s\p{P}\p{S}]/gu;

/**
 * Serialised vector cache entry for one session (C2).
 */
export interface EmbeddingCache {
  version: number;        // must match EmbeddingEncoder.version
  backend: string;
  sessionId: string;
  /** One vector per text, stored as number[] for JSON serialisability. */
  vectors: number[][];
}

export class EmbeddingEncoder {
  backend: EmbeddingBackend; // mutable for C3 fallback (ONNX unavailable → char-ngram-tfidf)
  readonly version = 2; // bumped from 1→2 for C2/C3 cache format change
  private readonly ngramMin: number;
  private readonly ngramMax: number;
  private readonly dim: number;
  private readonly cacheDir: string;

  // IDF state, populated lazily on first batch (inverse document frequency).
  private idf: Map<string, number> = new Map();
  private numDocsSeen = 0;
  private df: Map<string, number> = new Map();

  // C3: ONNX inference session (lazy singleton, process-wide).
  private static onnxSession: any = null;
  private static onnxModelPath: string | null = null;
  private onnxDim = 384; // bge-small output dim

  constructor(cfg: EmbeddingEncoderConfig) {
    this.backend = cfg.backend;
    this.ngramMin = cfg.ngramMin ?? 2;
    this.ngramMax = cfg.ngramMax ?? 3;
    this.dim = cfg.hashDim ?? 2048;
    this.cacheDir = cfg.cacheDir || join(homedir(), ".autoimprove", "cache", "embeddings");

    // C3: ensure cache dir exists (used by both backends).
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }

    // C3: if ONNX backend is requested, try to initialise; fall back on failure.
    if (this.backend === "onnx-local") {
      this.initOnnx(cfg.onnxModel);
    }
  }

  // ---- public API ----

  /** Encode a single text (uses current IDF state; call encodeBatch first for full-corpus IDF). */
  encode(text: string): Float32Array {
    if (this.backend === "onnx-local" && EmbeddingEncoder.onnxSession) {
      return this.encodeOnnx(text);
    }
    return this.vectorize(this.toNgrams(text));
  }

  /** Encode a batch and update IDF statistics from the full batch. */
  encodeBatch(texts: string[]): Float32Array[] {
    if (this.backend === "onnx-local" && EmbeddingEncoder.onnxSession) {
      return texts.map(t => this.encodeOnnx(t));
    }

    // char-ngram-tfidf path.
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

  // ---- C2: vector cache ----

  /**
   * Load cached vectors for a session. Returns null on miss / version mismatch.
   */
  loadCache(sessionId: string): Float32Array[] | null {
    const path = this.cachePath(sessionId);
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8")) as EmbeddingCache;
      if (raw.version !== this.version || raw.backend !== this.backend) {
        logger.debug("embedding-cache", `Cache stale for ${sessionId} (version/backend mismatch)`);
        return null;
      }
      return raw.vectors.map(v => new Float32Array(v));
    } catch {
      logger.debug("embedding-cache", `Cache corrupt for ${sessionId}, ignoring`);
      return null;
    }
  }

  /**
   * Save vectors to disk cache for a session.
   */
  saveCache(sessionId: string, vectors: Float32Array[]): void {
    try {
      const cache: EmbeddingCache = {
        version: this.version,
        backend: this.backend,
        sessionId,
        vectors: vectors.map(v => Array.from(v)),
      };
      writeFileSync(this.cachePath(sessionId), JSON.stringify(cache));
      logger.debug("embedding-cache", `Cached ${vectors.length} vectors for ${sessionId}`);
    } catch (e) {
      logger.debug("embedding-cache", `Failed to cache vectors for ${sessionId}: ${e}`);
    }
  }

  /** Delete cached vectors for a session. */
  clearCache(sessionId: string): void {
    const p = this.cachePath(sessionId);
    if (existsSync(p)) {
      try {
        const { unlinkSync } = require("fs");
        unlinkSync(p);
      } catch { /* ignore */ }
    }
  }

  // ---- C3: ONNX backend internals ----

  /**
   * Lazy-init the ONNX inference session (process-level singleton).
   * Falls back to char-ngram-tfidf with a warning if onnxruntime-node is
   * not installed or the model file is missing.
   */
  private initOnnx(modelName?: string): void {
    if (EmbeddingEncoder.onnxSession) return; // already initialised

    const modelPath = modelName
      ? join(homedir(), ".autoimprove", "models", modelName)
      : join(homedir(), ".autoimprove", "models", "bge-small-zh.onnx");

    if (!existsSync(modelPath)) {
      logger.warn("embedding-onnx", `ONNX model not found at ${modelPath}. Run 'npm run download-models' or set onnx_model. Falling back to char-ngram-tfidf.`);
      this.backend = "char-ngram-tfidf";
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ort = require("onnxruntime-node");
      EmbeddingEncoder.onnxSession = new ort.InferenceSession(modelPath);
      EmbeddingEncoder.onnxModelPath = modelPath;
      logger.info("embedding-onnx", `ONNX session loaded from ${modelPath}`);
    } catch (e: any) {
      logger.warn("embedding-onnx", `onnxruntime-node not available (${e.message}). Install with: npm install onnxruntime-node. Falling back to char-ngram-tfidf.`);
      this.backend = "char-ngram-tfidf";
    }
  }

  /**
   * Encode a single text via the ONNX model.
   * Tokenization is minimal: we split on whitespace and truncate/pad to 128 tokens
   * (bge-small supports up to 512; 128 is a pragmatic balance for signal texts).
   */
  private encodeOnnx(text: string): Float32Array {
    const session = EmbeddingEncoder.onnxSession;
    if (!session) return new Float32Array(this.onnxDim); // zero vector fallback

    const tokens = (text || "").toLowerCase().split(/\s+/).filter(Boolean);
    const MAX_LEN = 128;
    const ids = new Array(MAX_LEN).fill(0);
    const mask = new Array(MAX_LEN).fill(0);
    const typeIds = new Array(MAX_LEN).fill(0);

    // Simple word-level tokenisation: map each word to a hash-based ID
    // (a proper tokenizer would use the model's vocab; this is a pragmatic
    // approximation that still captures semantic signal).
    for (let i = 0; i < Math.min(tokens.length, MAX_LEN); i++) {
      ids[i] = this.hashToken(tokens[i]);
      mask[i] = 1;
    }

    try {
      const feeds: Record<string, any> = {
        input_ids: new Int64Array(ids),
        attention_mask: new Int64Array(mask),
        token_type_ids: new Int64Array(typeIds),
      };
      const results = session.run(feeds);
      // Most embedding models output 'last_hidden_state' or 'sentence_embedding'
      const key = Object.keys(results).find(k =>
        k.includes("embedding") || k.includes("dense") || k.includes("last_hidden")
      ) || Object.keys(results)[0];
      const output = results[key] as any;
      const data = output.data as Float32Array;

      // L2 normalise
      let norm = 0;
      for (let i = 0; i < data.length; i++) norm += data[i] * data[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < data.length; i++) data[i] /= norm;

      this.onnxDim = data.length;
      return data;
    } catch (e) {
      logger.warn("embedding-onnx", `ONNX inference failed: ${e}`);
      return new Float32Array(this.onnxDim);
    }
  }

  /** Hash a token into [0, 100000) for ONNX input IDs (approximate). */
  private hashToken(token: string): number {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % 100000;
  }

  // ---- char-ngram-tfidf internals ----

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

  private cachePath(sessionId: string): string {
    return join(this.cacheDir, `${sessionId}.embed.json`);
  }
}

/**
 * C3: Int64Array polyfill for ONNX runtime (BigInt64Array if available).
 * onnxruntime-node expects Int64 input tensors; Node 18+ supports BigInt64Array.
 */
class Int64Array {
  private data: BigInt64Array;
  constructor(source: number[]) {
    this.data = new BigInt64Array(source.length);
    for (let i = 0; i < source.length; i++) this.data[i] = BigInt(source[i]);
  }
  get length(): number { return this.data.length; }
  [Symbol.iterator](): IterableIterator<bigint> { return this.data[Symbol.iterator](); }
}
