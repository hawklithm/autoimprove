/**
 * Local ML A/B rollout utility (G2).
 *
 * Routes a session to the new (local_ml) pipeline or the legacy pipeline based
 * on a stable hash of the session id and the configured `ab_test.rollout`
 * fraction (0..1). Each dimension (prefilter / clusterer / signal_match /
 * personalization) can additionally be gated by its own enabled flag, so a
 * module is only "new" when BOTH (a) the rollout bucket selects it AND
 * (b) its local_ml.<dimension>.enabled (or mode != legacy) is on. Legacy
 * behavior is always reachable by setting rollout = 0.
 */

import { loadConfig } from "../storage/init.js";

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff; // 0..1
}

/**
 * Stable bucket decision for a dimension. Returns true if the session should
 * use the NEW pipeline for that dimension.
 */
export function shouldUseNewPipeline(sessionId: string, dimension: "prefilter" | "clusterer" | "signal_match" | "personalization"): boolean {
  const cfg = loadConfig().local_ml;
  if (!cfg || !cfg.enabled) return false;

  const rollout = cfg.ab_test?.rollout ?? 0;
  if (rollout <= 0) return false;
  if (rollout >= 1) return true;

  // Stable per-(session,dimension) bucket so a session is consistent across calls.
  const bucket = hashString(`${dimension}:${sessionId}`);
  return bucket < rollout;
}
