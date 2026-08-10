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
 * C4: ONNX tokenizer uses @node-rs/jieba for Chinese word segmentation (optional dep).
 *      When jieba is unavailable, falls back to character-level tokenization so
 *      Chinese text still produces differentiated vectors.
 *
 * Vectors are L2-normalized so cosine similarity == dot product.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createRequire } from "module";
import { logger } from "./logger.js";
import { ensureJieba, tokenizeWithJieba } from "./jieba-utils.js";

// C3: createRequire lets us load onnxruntime-node synchronously in ESM/tsx.
const _require = createRequire(import.meta.url);

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

/**
 * ONNX singleton initialisation state.
 * InferenceSession.create() is async (onnxruntime-node v1.17+), so we store
 * a promise and await it on the first encode/encodeBatch call. This guarantees
 * ONNX is ready before any encoding happens, without blocking the constructor.
 */
let onnxInitPromise: Promise<void> | null = null;

function ensureOnnxInit(modelName?: string): void {
  if (EmbeddingEncoder.onnxSession) return;        // already initialised
  if (onnxInitPromise) return;                     // already initialising

  const modelPath = modelName
    ? join(homedir(), ".autoimprove", "models", modelName)
    : join(homedir(), ".autoimprove", "models", "bge-small-zh.onnx");

  if (!existsSync(modelPath)) {
    logger.warn("embedding-onnx", `ONNX model not found at ${modelPath}. Run 'npm run download-models' or set onnx_model. Falling back to char-ngram-tfidf.`);
    return; // caller handles fallback
  }

  onnxInitPromise = (async () => {
    try {
      // Use dynamic import() for ESM/tsx compatibility.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      // @ts-ignore - onnxruntime-node has no type declarations
      const ort = await import("onnxruntime-node") as any;
      const session = await ort.InferenceSession.create(modelPath);
      if (!session.inputNames || session.inputNames.length === 0) {
        throw new Error("ONNX session has no input names");
      }
      EmbeddingEncoder.onnxSession = session;
      EmbeddingEncoder.onnxModelPath = modelPath;
      EmbeddingEncoder.onnxTensorCtor = ort.Tensor;
      logger.info("embedding-onnx", `ONNX session loaded from ${modelPath}`);
    } catch (e: any) {
      logger.warn("embedding-onnx", `ONNX init failed (${e.message}). Falling back to char-ngram-tfidf.`);
    }
  })();
}

export class EmbeddingEncoder {
  backend: EmbeddingBackend; // mutable for fallback (ONNX unavailable → char-ngram-tfidf)
  readonly version = 2; // bumped from 1→2 for C2/C3 cache format change
  private readonly ngramMin: number;
  private readonly ngramMax: number;
  private readonly dim: number;
  private readonly cacheDir: string;

  // IDF state, populated lazily on first batch (inverse document frequency).
  private idf: Map<string, number> = new Map();
  private numDocsSeen = 0;
  private df: Map<string, number> = new Map();

  // ONNX inference session (process-level singleton, synchronously initialised).
  static onnxSession: any = null;
  static onnxModelPath: string | null = null;
  static onnxTensorCtor: any = null;
  static onnxInitialising = false;
  private onnxDim = 384; // bge-small output dim

  constructor(cfg: EmbeddingEncoderConfig) {
    this.backend = cfg.backend;
    this.ngramMin = cfg.ngramMin ?? 2;
    this.ngramMax = cfg.ngramMax ?? 3;
    this.dim = cfg.hashDim ?? 2048;
    this.cacheDir = cfg.cacheDir || join(homedir(), ".autoimprove", "cache", "embeddings");

    // The cache directory is created lazily in saveCache(), not here. Many
    // consumers (e.g. MemoryConsolidator via MemorySimilarity) only ever call
    // encode/encodeSync and never touch the disk cache, so doing filesystem
    // work in the constructor charged every instantiation for I/O it did not use.

    // Start async ONNX initialisation (or no-op if already done).
    // The first encode/encodeBatch call will await it before proceeding.
    if (this.backend === "onnx-local") {
      ensureOnnxInit(cfg.onnxModel);
    }
  }

  /**
   * Ensure ONNX is initialised before encoding.
   * If ONNX init is still pending, await it. On success, subsequent calls
   * skip this check entirely. On failure, backend is downgraded transparently.
   */
  private async ensureOnnxReady(): Promise<void> {
    if (this.backend !== "onnx-local") return;
    if (EmbeddingEncoder.onnxSession) return; // already ready
    if (onnxInitPromise) {
      await onnxInitPromise;
    }
    // Downgrade to char-ngram-tfidf if ONNX init failed
    if (!EmbeddingEncoder.onnxSession) {
      this.backend = "char-ngram-tfidf";
    }
  }

  // ---- public API ----
  // ---- public API ----
  // ONNX inference (session.run()) is inherently async. Callers MUST await
  // these methods. The first call may block briefly (10-500ms) while ONNX
  // model loads; subsequent calls are fast.

  /**
   * Eagerly preload the ONNX model. Call this once before starting batch
   * processing so that the model is ready before any session analysis begins.
   * Idempotent — safe to call multiple times.
   */
  static async preloadOnnx(modelName?: string): Promise<void> {
    ensureOnnxInit(modelName);
    if (onnxInitPromise) {
      await onnxInitPromise;
    }
  }

  /**
   * Check whether the ONNX backend is ready (model loaded and usable).
   */
  static isOnnxReady(): boolean {
    return EmbeddingEncoder.onnxSession !== null;
  }

  /** Encode a single text (uses current IDF state; call encodeBatch first for full-corpus IDF). */
  async encode(text: string): Promise<Float32Array> {
    await this.ensureOnnxReady();
    if (this.backend === "onnx-local") {
      return this.encodeOnnx(text);
    }
    // char-ngram-tfidf path (also used as transparent fallback when ONNX is unavailable).
    return this.vectorize(this.toNgrams(text));
  }

  /** Encode a batch and update IDF statistics from the full batch. */
  async encodeBatch(texts: string[]): Promise<Float32Array[]> {
    await this.ensureOnnxReady();
    if (this.backend === "onnx-local") {
      return this.encodeOnnxBatch(texts);
    }
    // char-ngram-tfidf path.
    return this.encodeBatchCharNgram(texts);
  }

  /**
   * Synchronous encode using the char-ngram-tfidf backend.
   *
   * ONNX inference is inherently async, so synchronous call sites (e.g.
   * `MemoryConsolidator.consolidate()`, which is sync and called from sync
   * analyzer code) cannot use it. This method always takes the char n-gram
   * path regardless of the configured backend, giving a deterministic
   * fuzzy-lexical vector without blocking the event loop.
   *
   * Prefer `encode()`/`encodeBatch()` wherever `await` is available.
   */
  encodeSync(text: string): Float32Array {
    return this.vectorize(this.toNgrams(text));
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
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }
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
        const { unlinkSync } = _require("fs");
        unlinkSync(p);
      } catch { /* ignore */ }
    }
  }

  // ---- ONNX backend internals ----

  /**
   * Encode a single text via the ONNX model.
   *
   * Tokenization uses @node-rs/jieba for Chinese + whitespace split for English
   * (C4). Falls back to character-level tokenization when jieba is unavailable.
   * Truncate/pad to 128 tokens (bge-small supports up to 512; 128 is a pragmatic
   * balance for signal texts).
   */
  private async encodeOnnx(text: string): Promise<Float32Array> {
    const session = EmbeddingEncoder.onnxSession;
    if (!session) {
      logger.info("embedding-onnx", "encodeOnnx called but no session — returning zero vector");
      return new Float32Array(this.onnxDim); // zero vector fallback
    }
    logger.debug("embedding-onnx", `encodeOnnx invoked: text="${text.substring(0, 60)}..." (len=${text.length})`);

    // C4: tokenize with jieba for Chinese, whitespace split for English
    const tokens = this.tokenizeOnnx(text);
    const MAX_LEN = 128;
    const ids = new Array(MAX_LEN).fill(0);
    const mask = new Array(MAX_LEN).fill(0);
    const typeIds = new Array(MAX_LEN).fill(0);

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

  /**
   * Encode a batch of texts in a single ONNX inference call.
   *
   * Instead of N separate session.run() calls (one per text), this creates a
   * single [batch_size, MAX_LEN] input tensor and runs one inference pass.
   * For bge-small-zh this typically yields a 5-10x throughput improvement
   * on CPU when the batch contains more than 2 texts.
   */
  private async encodeOnnxBatch(texts: string[]): Promise<Float32Array[]> {
    const session = EmbeddingEncoder.onnxSession;
    if (!session || texts.length === 0) {
      return texts.map(() => new Float32Array(this.onnxDim));
    }

    // Single-text path: delegate to the existing method (no batching overhead).
    if (texts.length === 1) {
      return [await this.encodeOnnx(texts[0])];
    }

    const MAX_LEN = 128;
    const batchSize = texts.length;

    // Pre-tokenize all texts
    const allTokens: string[][] = texts.map(t => this.tokenizeOnnx(t));

    // Build flat tensors of shape [batchSize * MAX_LEN]
    const totalLen = batchSize * MAX_LEN;
    const allIds = new BigInt64Array(totalLen);
    const allMask = new BigInt64Array(totalLen);
    const allTypeIds = new BigInt64Array(totalLen);

    for (let b = 0; b < batchSize; b++) {
      const tokens = allTokens[b];
      const offset = b * MAX_LEN;
      // [CLS]
      allIds[offset] = 101n;
      allMask[offset] = 1n;
      for (let i = 0; i < Math.min(tokens.length, MAX_LEN - 2); i++) {
        allIds[offset + i + 1] = BigInt(this.hashToken(tokens[i]));
        allMask[offset + i + 1] = 1n;
      }
      // [SEP]
      const sepPos = Math.min(tokens.length, MAX_LEN - 2) + 1;
      allIds[offset + sepPos] = 102n;
      allMask[offset + sepPos] = 1n;
    }

    try {
      const Tensor = EmbeddingEncoder.onnxTensorCtor;
      if (!Tensor) {
        throw new Error("onnxruntime-node Tensor constructor not available");
      }

      const feeds = {
        input_ids: new Tensor('int64', allIds, [batchSize, MAX_LEN]),
        attention_mask: new Tensor('int64', allMask, [batchSize, MAX_LEN]),
        token_type_ids: new Tensor('int64', allTypeIds, [batchSize, MAX_LEN]),
      };

      logger.info("embedding-onnx", `encodeOnnxBatch: running ${batchSize} texts in one inference pass`);

      const r = await (session as any).run(feeds, {}, {});

      const outputKey = Object.keys(r).find(k => k !== 'token_type_ids' && k !== 'attention_mask')
        || Object.keys(r)[0];
      if (!outputKey) {
        throw new Error("No output found in ONNX result");
      }

      const out = r[outputKey] as any;
      const dim = out.dims[out.dims.length - 1] as number;
      const totalData = Array.from(out.data) as number[];

      // Split batch result: each row is [CLS] (first token position) vector.
      // For bge-small-zh with mean-pooling output shape [batchSize, dim],
      // we take the full row. For [batchSize, seqLen, dim] we take position 0.
      const results: Float32Array[] = [];
      const stride = out.dims.length === 3 ? out.dims[1] * dim : dim;
      for (let b = 0; b < batchSize; b++) {
        const start = b * stride;
        // For pooled output ([batchSize, dim]): take the full row.
        // For hidden state ([batchSize, seqLen, dim]): take the CLS position.
        const vecData = out.dims.length === 3
          ? totalData.slice(start, start + dim)  // CLS (position 0)
          : totalData.slice(start, start + dim); // full row

        // L2 normalize
        let norm = 0;
        for (const x of vecData) norm += x * x;
        norm = Math.sqrt(norm) || 1;
        results.push(new Float32Array(vecData.map(v => v / norm)));
      }

      if (results.length > 0) {
        this.onnxDim = results[0].length;
      }
      return results;
    } catch (e) {
      logger.warn("embedding-onnx", `ONNX batch inference failed: ${e}, falling back to per-text inference`);
      // Fall back to per-text inference on batch failure
      return Promise.all(texts.map(t => this.encodeOnnx(t)));
    }
  }

  /**
   * Tokenize text for ONNX input: uses jieba for Chinese, whitespace split for English.
   * Falls back to character-level tokenization when jieba is unavailable (C4).
   * Delegates to shared jieba-utils.
   */
  private tokenizeOnnx(text: string): string[] {
    return tokenizeWithJieba(text, 1);
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
