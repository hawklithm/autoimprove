import { createMemoryId, MemoryMutation, MemoryRecord, MemoryRepository } from "./memory-models.js";
import { MemoryStore } from "../storage/memory-store.js";
import { createDefaultMemoryRepository } from "../storage/memory-sqlite-store.js";

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^\p{L}\p{N}_+#.-]+/u).filter(Boolean));
}

function similarity(a: MemoryRecord, b: MemoryRecord): number {
  const left = new Set([...tokens(`${a.content} ${a.keywords.join(" ")}`), a.kind]);
  const right = new Set([...tokens(`${b.content} ${b.keywords.join(" ")}`), b.kind]);
  const intersection = [...left].filter(token => right.has(token)).length;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
}

export class MemoryConsolidator {
  private readonly store: MemoryRepository;

  constructor(store?: MemoryRepository) {
    this.store = store || createDefaultMemoryRepository();
  }

  consolidate(candidate: MemoryRecord): MemoryMutation {
    const existing = this.store.list({ activeOnly: true, projectPath: candidate.namespace?.project_path })
      .map(memory => ({ memory, score: similarity(memory, candidate) }))
      .filter(item => item.score >= 0.55)
      .sort((a, b) => b.score - a.score)[0];

    if (!existing) return { decision: "ADD", memory: candidate };

    const sameEntityRelation = this.sameEntityRelation(existing.memory, candidate);
    const sameContent = similarity(existing.memory, candidate) >= 0.9;
    if (sameContent) {
      const merged: MemoryRecord = {
        ...existing.memory,
        evidence: this.mergeEvidence(existing.memory, candidate),
        keywords: Array.from(new Set([...existing.memory.keywords, ...candidate.keywords])),
        entities: this.mergeEntities(existing.memory.entities || [], candidate.entities || []),
        relations: this.mergeRelations(existing.memory.relations || [], candidate.relations || []),
        outcome: candidate.outcome?.status !== "unknown" ? candidate.outcome : existing.memory.outcome,
        metadata: {
          ...(existing.memory.metadata || {}),
          ...(candidate.metadata || {}),
          project_paths: Array.from(new Set([
            ...((existing.memory.metadata?.project_paths as string[] | undefined) || []),
            ...((candidate.metadata?.project_paths as string[] | undefined) || [])
          ]))
        },
        confidence: Math.max(existing.memory.confidence, candidate.confidence),
        importance: Math.max(existing.memory.importance, candidate.importance),
        strength: existing.memory.strength + candidate.strength,
        state: this.nextState(existing.memory, candidate),
        support_count: (existing.memory.support_count || 1) + (candidate.support_count || 1),
        independent_session_count: new Set([
          ...existing.memory.evidence.map(item => item.session_id),
          ...candidate.evidence.map(item => item.session_id)
        ]).size,
        independent_project_count: new Set([
          ...((existing.memory.metadata?.project_paths as string[] | undefined) || []),
          ...((candidate.metadata?.project_paths as string[] | undefined) || []),
          existing.memory.namespace?.project_path,
          candidate.namespace?.project_path
        ].filter(Boolean)).size,
        validation_count: (existing.memory.validation_count || 0) + (candidate.validation_count || 0),
        contradiction_count: (existing.memory.contradiction_count || 0) + (candidate.contradiction_count || 0),
        updated_at: candidate.updated_at
      };
      return { decision: "UPDATE", memory: merged, previous_id: existing.memory.id };
    }

    // A newer, materially different candidate in the same category is kept as
    // a new version instead of overwriting historical evidence.
    if (sameEntityRelation || (candidate.kind === existing.memory.kind && candidate.pattern_type === existing.memory.pattern_type && existing.score >= 0.7)) {
      return {
        decision: "SUPERSEDE",
        previous_id: existing.memory.id,
        memory: { ...candidate, id: createMemoryId(), supersedes: existing.memory.id }
      };
    }

    return { decision: "NOOP", memory: existing.memory };
  }

  persist(candidate: MemoryRecord): MemoryMutation {
    const mutation = this.consolidate(candidate);
    if (mutation.decision !== "NOOP") this.store.apply(mutation);
    return mutation;
  }

  private mergeEvidence(a: MemoryRecord, b: MemoryRecord) {
    const seen = new Set(a.evidence.map(item => `${item.session_id}:${item.message_lines.join(",")}`));
    return [...a.evidence, ...b.evidence.filter(item => !seen.has(`${item.session_id}:${item.message_lines.join(",")}`))];
  }

  private sameEntityRelation(a: MemoryRecord, b: MemoryRecord): boolean {
    const left = new Set((a.relations || []).map(relation => `${relation.subject}|${relation.predicate}`));
    const right = new Set((b.relations || []).map(relation => `${relation.subject}|${relation.predicate}`));
    return left.size > 0 && [...left].some(key => right.has(key));
  }

  private mergeEntities(a: NonNullable<MemoryRecord["entities"]>, b: NonNullable<MemoryRecord["entities"]>) {
    const merged = new Map(a.map(entity => [entity.id || `${entity.type}:${entity.name}`, entity]));
    for (const entity of b) merged.set(entity.id || `${entity.type}:${entity.name}`, entity);
    return Array.from(merged.values());
  }

  private mergeRelations(a: NonNullable<MemoryRecord["relations"]>, b: NonNullable<MemoryRecord["relations"]>) {
    const merged = new Map(a.map(relation => [`${relation.subject}|${relation.predicate}|${relation.object}`, relation]));
    for (const relation of b) merged.set(`${relation.subject}|${relation.predicate}|${relation.object}`, relation);
    return Array.from(merged.values());
  }

  private nextState(existing: MemoryRecord, candidate: MemoryRecord): MemoryRecord["state"] {
    if (existing.state === "validated" || candidate.state === "validated") return "validated";
    const support = (existing.support_count || 1) + (candidate.support_count || 1);
    return support >= 2 ? "supported" : "observed";
  }
}
