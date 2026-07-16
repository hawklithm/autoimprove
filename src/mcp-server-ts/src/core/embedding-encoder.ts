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
  private static onnxInitPromise: Promise<void> | null = null;
  private static onnxTensorCtor: any = null;
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
  // NOTE: ONNX inference (onnxruntime-node) is inherently async (session.run()
  // returns a Promise). These methods are therefore async. Callers MUST await
  // them. The previous synchronous spin-wait implementation blocked the Node
  // event loop (the .then callback never ran) and burned a 30s busy-wait per
  // call at 100% CPU — see encodeOnnx.

  /** Encode a single text (uses current IDF state; call encodeBatch first for full-corpus IDF). */
  async encode(text: string): Promise<Float32Array> {
    if (this.backend === "onnx-local" && EmbeddingEncoder.onnxSession) {
      return this.encodeOnnx(text);
    }
    // char-ngram-tfidf path (also used as transparent fallback while/if ONNX is unavailable).
    return this.vectorize(this.toNgrams(text));
  }

  /** Encode a batch and update IDF statistics from the full batch. */
  async encodeBatch(texts: string[]): Promise<Float32Array[]> {
    if (this.backend === "onnx-local" && EmbeddingEncoder.onnxSession) {
      return Promise.all(texts.map(t => this.encodeOnnx(t)));
    }

    // char-ngram-tfidf path.
    return this.encodeBatchCharNgram(texts);
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
   *
   * NOTE: onnxruntime-node v1.17+ only supports the async create() API.
   * We use a synchronous-looking wrapper that queues encodeOnnx calls
   * until the session is ready, but since encode/encodeBatch are
   * synchronous in our API, we store a promise and check it on each
   * encode call. If the promise is still pending, we fall back to
   * char-ngram-tfidf for the first calls and switch to ONNX once ready.
   */
  private initOnnx(modelName?: string): void {
    if (EmbeddingEncoder.onnxSession) return; // already initialised
    if (EmbeddingEncoder.onnxInitPromise) return; // already initialising

    const modelPath = modelName
      ? join(homedir(), ".autoimprove", "models", modelName)
      : join(homedir(), ".autoimprove", "models", "bge-small-zh.onnx");

    if (!existsSync(modelPath)) {
      logger.warn("embedding-onnx", `ONNX model not found at ${modelPath}. Run 'npm run download-models' or set onnx_model. Falling back to char-ngram-tfidf.`);
      this.backend = "char-ngram-tfidf";
      return;
    }

    // Store a promise so concurrent calls don't race.
    EmbeddingEncoder.onnxInitPromise = (async () => {
      try {
        // Use dynamic import() instead of require() for ESM compatibility
        // (require() fails in tsx/ESM mode with "require is not defined")
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        // @ts-ignore - onnxruntime-node has no type declarations
        const ort = await import("onnxruntime-node") as any;
        const session = await ort.InferenceSession.create(modelPath);
        // Validate the session has inputs
        if (!session.inputNames || session.inputNames.length === 0) {
          throw new Error("ONNX session has no input names");
        }
        EmbeddingEncoder.onnxSession = session;
        EmbeddingEncoder.onnxModelPath = modelPath;
        EmbeddingEncoder.onnxTensorCtor = ort.Tensor;
        logger.info("embedding-onnx", `ONNX session loaded from ${modelPath}`);
      } catch (e: any) {
        logger.warn("embedding-onnx", `ONNX init failed (${e.message}). Falling back to char-ngram-tfidf.`);
        this.backend = "char-ngram-tfidf";
      }
    })();

    // Also register a sync fallback: if the promise hasn't resolved by
    // the time encode/encodeBatch is called, we transparently fall back.
    EmbeddingEncoder.onnxInitPromise.then(() => {
      // success — next encode calls will use ONNX
    }).catch(() => {
      this.backend = "char-ngram-tfidf";
    });
  }

  /**
   * Encode a single text via the ONNX model.
   * Tokenization is minimal: we split on whitespace and truncate/pad to 128 tokens
   * (bge-small supports up to 512; 128 is a pragmatic balance for signal texts).
   *
   * onnxruntime-node v1.17+ only supports async session.run(). Since our encode()
   * API is synchronous, we use a spin-wait on the async result (CPU-bound,
   * typically 10-50ms). For batch encoding, encodeBatch uses the async path
   * directly via runOnnxBatch.
   *
   * NOTE: We avoid child process (execSync) approach because it's unreliable
   * in ESM/tsx runtime environments. The spin-wait approach works in both CJS
   * and ESM modes.
   */
  private async encodeOnnx(text: string): Promise<Float32Array> {
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
    // Use 101 ([CLS]) as the first token for sentence-level embedding.
    ids[0] = 101;
    mask[0] = 1;
    for (let i = 0; i < Math.min(tokens.length, MAX_LEN - 2); i++) {
      ids[i + 1] = this.hashToken(tokens[i]);
      mask[i + 1] = 1;
    }
    // Put 102 ([SEP]) at the end of actual tokens
    const sepPos = Math.min(tokens.length, MAX_LEN - 1);
    ids[sepPos] = 102;
    mask[sepPos] = 1;

    try {
      const Tensor = EmbeddingEncoder.onnxTensorCtor;
      if (!Tensor) {
        throw new Error("onnxruntime-node Tensor constructor not available");
      }

      const feeds = {
        input_ids: new Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, MAX_LEN]),
        attention_mask: new Tensor('int64', BigInt64Array.from(mask.map(BigInt)), [1, MAX_LEN]),
        token_type_ids: new Tensor('int64', BigInt64Array.from(typeIds.map(BigInt)), [1, MAX_LEN]),
      };

      // onnxruntime-node's session.run() returns a Promise. AWAIT it properly.
      // The previous implementation busy-waited on the async result with a
      // synchronous `while` loop, which blocked the Node event loop so the
      // `.then` callback never executed — every call burned a 30s timeout at
      // 100% CPU and returned a zero vector. We now await the promise, which
      // yields to the event loop and resolves correctly.
      const r = await (session as any).run(feeds, {}, {});

      // Find the output key (usually 'last_hidden_state' or 'sentence_embedding')
      const outputKey = Object.keys(r).find(k => k !== 'token_type_ids' && k !== 'attention_mask')
        || Object.keys(r)[0];
      if (!outputKey) {
        throw new Error("No output found in ONNX result");
      }
      const out = r[outputKey] as any;
      const dim = out.dims[out.dims.length - 1] as number;
      const data = Array.from(out.data.slice(0, dim)) as number[];
      // L2 normalize
      let norm = 0; for (const x of data) norm += x * x;
      norm = Math.sqrt(norm) || 1;
      const normalized = data.map(v => v / norm);
      const result = new Float32Array(normalized);

      this.onnxDim = result.length;
      return result;
    } catch (e) {
      logger.warn("embedding-onnx", `ONNX inference failed: ${e}`);
      return new Float32Array(this.onnxDim);
    }
  }

  /** Hash a token into [0, vocabSize) for ONNX input IDs. bge-small-zh vocab is 21128. */
  private hashToken(token: string, vocabSize: number = 21128): number {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) % vocabSize;
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

  /**
   * Run the char-ngram-tfidf encoding pipeline for a batch.
   * Extracted as a separate method so it can be called from both encodeBatch
   * and the ONNX-pending fallback path.
   */
  private encodeBatchCharNgram(texts: string[]): Float32Array[] {
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
