import { MemoryRecord, MemoryRepository } from "./memory-models.js";
import { MemoryConflictResolver } from "./memory-conflict-resolver.js";
import { LLMConfigManager } from "./llm-config-manager.js";

export interface PromotionDecision {
  eligible: boolean;
  score: number;
  reason: string;
}

/** Promotes durable procedural memories without turning every observation into a rule. */
export class MemoryPromotionService {
  private readonly conflicts = new MemoryConflictResolver();
  private readonly llm = new LLMConfigManager();
  constructor(private readonly store: MemoryRepository) {}

  evaluate(memory: MemoryRecord): PromotionDecision {
    if (memory.kind !== "procedural") return { eligible: false, score: 0, reason: "Only procedural memories can become rules" };
    const sessions = memory.independent_session_count || new Set(memory.evidence.map(item => item.session_id)).size || 1;
    const projects = Math.max(memory.independent_project_count || 0, Array.isArray(memory.metadata?.project_paths) ? memory.metadata.project_paths.length : 0, memory.namespace?.project_path ? 1 : 0);
    const validation = Math.min(1, (memory.validation_count || 0) / 3);
    const contradiction = Math.min(1, (memory.contradiction_count || 0) / 2);
    if (this.conflicts.hasConflict(memory, this.store.list({ activeOnly: true, kind: "procedural" }))) {
      return { eligible: false, score: 0, reason: "Conflicts with another procedural memory in the same scope" };
    }
    const score = Math.max(0, Math.min(1,
      memory.confidence * 0.35 + Math.min(1, sessions / 3) * 0.25 + Math.min(1, projects / 2) * 0.1
      + validation * 0.2 + Math.min(1, memory.strength / 5) * 0.1 - contradiction * 0.35
    ));
    const explicit = memory.outcome?.user_confirmed === true;
    const eligible = (explicit || sessions >= 2 || validation > 0) && contradiction === 0 && score >= 0.6;
    return { eligible, score, reason: explicit ? "Explicitly confirmed procedural memory" : eligible ? "Repeated and sufficiently supported" : "Insufficient independent support or validation" };
  }

  promoteEligible(): MemoryRecord[] {
    const promoted: MemoryRecord[] = [];
    for (const memory of this.store.list({ activeOnly: true, kind: "procedural" })) {
      const decision = this.evaluate(memory);
      if (!decision.eligible || memory.state === "promoted") continue;
      const updated: MemoryRecord = { ...memory, state: "promoted", updated_at: new Date().toISOString(), metadata: { ...(memory.metadata || {}), promotion_score: decision.score, promotion_reason: decision.reason } };
      this.store.apply({ decision: "UPDATE", memory: updated, previous_id: memory.id });
      promoted.push(updated);
    }
    return promoted;
  }

  async promoteEligibleWithLLM(): Promise<MemoryRecord[]> {
    const promoted: MemoryRecord[] = [];
    const candidates = this.store.list({ activeOnly: true, kind: "procedural" });
    for (const memory of candidates) {
      const heuristic = this.evaluate(memory);
      if (!heuristic.eligible || memory.state === "promoted") continue;
      if (await this.conflicts.hasConflictWithLLM(memory, candidates)) continue;
      const generalization = await this.evaluateGeneralization(memory, candidates);
      if (!generalization.eligible) continue;
      const updated: MemoryRecord = {
        ...memory,
        state: "promoted",
        updated_at: new Date().toISOString(),
        metadata: {
          ...(memory.metadata || {}),
          promotion_score: Math.min(1, heuristic.score * 0.7 + generalization.confidence * 0.3),
          promotion_scope: generalization.scope,
          promotion_reason: generalization.reason,
          generalization_confidence: generalization.confidence
        }
      };
      this.store.apply({ decision: "UPDATE", memory: updated, previous_id: memory.id });
      promoted.push(updated);
    }
    return promoted;
  }

  private async evaluateGeneralization(memory: MemoryRecord, candidates: MemoryRecord[]): Promise<{ eligible: boolean; scope: "project" | "organization" | "global"; confidence: number; reason: string }> {
    const projectPaths = new Set(
      candidates
        .filter(candidate => this.similar(candidate, memory))
        .flatMap(candidate => Array.isArray(candidate.metadata?.project_paths) ? candidate.metadata.project_paths as string[] : [candidate.namespace?.project_path].filter(Boolean) as string[])
    );
    const defaultScope = projectPaths.size >= 3 ? "organization" : "project";
    const fallback = { eligible: true, scope: defaultScope as "project" | "organization", confidence: Math.min(1, projectPaths.size / 3 + 0.4), reason: `Heuristic promotion across ${projectPaths.size || 1} project context(s)` };
    if (!this.llm.isAvailable()) return fallback;
    try {
      const prompt = `Classify whether this procedural coding memory can be generalized. Return JSON only: {"generalizable":true,"scope":"project|organization|global","confidence":0.0,"reason":"..."}. Never choose global for private/internal systems or project-specific modules. Memory: ${memory.content}. Namespace: ${JSON.stringify(memory.namespace || {})}. Related project count: ${projectPaths.size}.`;
      const response = await this.llm.callWithFallback(async (client, model) => client.chat.completions.create({ model, max_tokens: 400, messages: [{ role: "user", content: prompt }] }), { fallbackOnError: true });
      const raw = response.choices[0]?.message?.content || "";
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
      let scope = ["project", "organization", "global"].includes(parsed.scope) ? parsed.scope as "project" | "organization" | "global" : fallback.scope;
      // Global rules require evidence beyond the current organization.  An LLM
      // suggestion must not bypass this conservative safety boundary.
      const organizationEvidence = Number(memory.metadata?.independent_organization_count || 0);
      if (scope === "project" && projectPaths.size >= 3) scope = "organization";
      if (scope === "global" && organizationEvidence < 2) {
        scope = projectPaths.size >= 3 ? "organization" : projectPaths.size >= 1 ? "project" : "project";
      }
      const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || fallback.confidence));
      return { eligible: parsed.generalizable !== false && confidence >= 0.6, scope, confidence, reason: typeof parsed.reason === "string" ? parsed.reason : fallback.reason };
    } catch {
      return fallback;
    }
  }

  private similar(a: MemoryRecord, b: MemoryRecord): boolean {
    const left = new Set(`${a.summary} ${a.keywords.join(" ")}`.toLowerCase().split(/[^\p{L}\p{N}_+#.-]+/u).filter(token => token.length > 2));
    const right = new Set(`${b.summary} ${b.keywords.join(" ")}`.toLowerCase().split(/[^\p{L}\p{N}_+#.-]+/u).filter(token => token.length > 2));
    return [...left].filter(token => right.has(token)).length / Math.max(1, Math.min(left.size, right.size)) >= 0.5;
  }
}
