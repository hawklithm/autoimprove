/**
 * Shared LLM call retry / timeout helpers.
 *
 * Centralizes the retry-and-timeout policy used by every LLM call path in the
 * project (LLMConfigManager, HybridRuleGenerator, template-based generator, etc.)
 * so that transient failures (network blips, 429 rate limits, 5xx, timeouts)
 * recover automatically instead of bubbling up as hard errors.
 */

import { logger } from "./logger.js";

/**
 * Default per-request timeout applied to every OpenAI client (ms).
 * Generous enough for real LLM inference, but finite so a dead endpoint fails
 * fast and lets the retry/backoff logic kick in. Override via LLM_TIMEOUT_MS.
 */
export const DEFAULT_LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60_000;

/**
 * Default number of *additional* retry attempts after the first failure.
 * Total attempts = 1 (initial) + DEFAULT_LLM_MAX_RETRIES (up to 4).
 */
export const DEFAULT_LLM_MAX_RETRIES = 3;

export interface RetryOptions {
  /** Additional retries after the first failure. Default: DEFAULT_LLM_MAX_RETRIES. */
  maxRetries?: number;
  /** Per-request client timeout (ms). Default: DEFAULT_LLM_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Base backoff between retries (ms). Default: 1000. */
  baseDelayMs?: number;
}

/**
 * Decide whether an error is worth retrying.
 * Retriable: network errors, timeouts, 429 (rate limit/quota), 5xx server errors.
 * Non-retriable: 4xx client errors (400/401/403), auth, malformed requests.
 */
export function isRetriableLLMError(err: any): boolean {
  if (!err) return false;

  const code = err.code ?? err.error?.code;
  if (typeof code === "string") {
    const c = code.toUpperCase();
    if (
      ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ECONNABORTED", "EPIPE", "ETIME"].includes(c)
    ) {
      return true;
    }
  }

  const status = err.status ?? err.statusCode;
  if (typeof status === "number") {
    if (status === 429 || (status >= 500 && status <= 599)) return true;
  }

  const msg = (err.message || "").toLowerCase();
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("network") ||
    msg.includes("econn") ||
    msg.includes("reset") ||
    msg.includes("aborted") ||
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("server error") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  ) {
    return true;
  }

  return false;
}

/**
 * Run an async LLM call with automatic retries and exponential backoff.
 * Non-retriable errors (e.g. auth/400) are rethrown immediately.
 */
export async function withLLMRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? DEFAULT_LLM_MAX_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? 1000;

  let lastErr: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const retriable = isRetriableLLMError(err);
      if (!retriable || attempt >= maxRetries) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt); // 1s, 2s, 4s ...
      logger.warn(
        "llm-retry",
        `LLM call attempt ${attempt + 1}/${maxRetries + 1} failed: ${String(err?.message || err).slice(0, 160)}; retrying in ${delay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
