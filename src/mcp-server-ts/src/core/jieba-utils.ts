/**
 * Jieba Utils — shared Chinese word segmentation for AutoImprove.
 *
 * Wraps @node-rs/jieba so that all tokenization paths (MessageClusterer,
 * PatternSimilarityClusterer, EmbeddingEncoder) share a single jieba instance.
 *
 * Falls back to character-level tokenization when the package is unavailable
 * (C4), ensuring the application never crashes from a missing native module.
 */

import { createRequire } from "module";
import { logger } from "./logger.js";

const _require = createRequire(import.meta.url);

/** Singleton jieba tokenizer instance. */
let jiebaTokenizer: any = null;

/**
 * Ensure jieba is loaded. Returns true if jieba is available, false otherwise.
 * Idempotent — safe to call multiple times.
 */
export function ensureJieba(): boolean {
  if (jiebaTokenizer) return true;
  try {
    const { Jieba } = _require("@node-rs/jieba") as any;
    jiebaTokenizer = new Jieba();
    logger.info("jieba-utils", "@node-rs/jieba initialized for Chinese word segmentation");
    return true;
  } catch {
    logger.warn("jieba-utils", "@node-rs/jieba not available, falling back to character-level tokenization for Chinese text");
    return false;
  }
}

/**
 * Regex to detect Chinese characters (CJK Unified Ideographs + Extension A).
 */
const CHINESE_RE = /[一-鿿㐀-䶿]/;

/**
 * Tokenize text using jieba for Chinese, whitespace split for English.
 *
 * @param text - Input text (may contain mixed Chinese/English).
 * @param minTokenLength - Minimum token length to keep (default 1).
 * @returns Array of token strings.
 */
export function tokenizeWithJieba(text: string, minTokenLength: number = 1): string[] {
  const raw = text || "";
  if (!raw.trim()) return [];

  const hasChinese = CHINESE_RE.test(raw);

  if (hasChinese && ensureJieba()) {
    // Use jieba with HMM mode for Chinese word segmentation
    const words = jiebaTokenizer.cut(raw, true) as string[];
    // Filter out punctuation and whitespace, lowercase
    return words
      .filter((w: string) => w.trim().length > 0 && !/^[，。！？、；：""''（）【】《》\s]+$/.test(w))
      .map((w: string) => w.toLowerCase())
      .filter((w: string) => w.length >= minTokenLength);
  }

  // Fallback: whitespace split for English or character-level for Chinese
  const whitespaceTokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
  if (whitespaceTokens.length > 1 || !hasChinese) {
    // English text or mixed with spaces: use whitespace tokens
    return whitespaceTokens.filter(w => w.length >= minTokenLength);
  }

  // Chinese text without jieba: character-level tokenization
  return raw
    .replace(/[^一-鿿㐀-䶿a-zA-Z0-9]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => w.length >= minTokenLength);
}
