import { createMemoryId, MemoryMutation, MemoryRecord, MemoryRepository } from "./memory-models.js";
import { createDefaultMemoryRepository } from "../storage/memory-sqlite-store.js";
import { MATCH_THRESHOLD, MERGE_THRESHOLD, MemorySimilarity } from "./memory-similarity.js";
import { MemoryConflictResolver } from "./memory-conflict-resolver.js";

function normalizeContent(value: string): string {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export class MemoryConsolidator {
  private readonly store: MemoryRepository;
  private readonly similarity: MemorySimilarity;
  private readonly conflictResolver: MemoryConflictResolver;

  constructor(store?: MemoryRepository, similarity?: MemorySimilarity) {
    this.store = store || createDefaultMemoryRepository();
    this.similarity = similarity || new MemorySimilarity();
    this.conflictResolver = new MemoryConflictResolver();
  }

  /**
   * [P2-1] Similarity is embedding cosine (with a Jaccard floor) instead of
   * plain word-set Jaccard, so paraphrased memories are recognised.
   *
   * [P2-2] The decision is an explicit three-way branch rather than a single
   * threshold:
   *
   *   UPDATE    — semantically equivalent (score ≥ MERGE_THRESHOLD).
   *               Merge evidence into the existing record.
   *   SUPERSEDE — same subject, incompatible statement (changed relation
   *               object / contrastive qualifier / opposing obligation).
   *               The user changed their mind; keep history, activate the new one.
   *   ADD       — same topic, different emphasis, no conflict. Both are kept.
   *
   * The previous implementation returned NOOP for this last case, silently
   * dropping complementary memories. It also superseded on "score ≥ 0.7 and
   * same kind/pattern_type", which with the stronger P2-1 scores would have
   * overwritten "run the build" with "run the tests". Both are fixed here.
   */
  consolidate(candidate: MemoryRecord): MemoryMutation {
    const existing = this.store.list({ activeOnly: true, projectPath: candidate.namespace?.project_path })
      .filter(memory => memory.id !== candidate.id)
      .map(memory => ({ memory, score: this.similarity.score(memory, candidate) }))
      .filter(item => item.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score)[0];

    if (!existing) return { decision: "ADD", memory: candidate };

    // Contradiction is checked BEFORE equivalence on purpose. "必须使用 X" and
    // "禁止使用 X" differ by two characters, so any text-similarity metric
    // rates them near-identical — merging them would silently destroy the
    // newer instruction. Meaning beats surface similarity here.
    const contradiction = this.detectContradiction(existing.memory, candidate);
    if (contradiction) return this.resolveContradiction(existing.memory, candidate, contradiction);

    if (existing.score >= MERGE_THRESHOLD) {
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

    // Same topic, different emphasis, no conflict -> both are worth keeping.
    return { decision: "ADD", memory: candidate };
  }

  /**
   * A contradiction on the same subject is either "the user changed their
   * mind" (newer candidate wins, history preserved via SUPERSEDE) or a stale
   * restatement of something we already superseded (kept but flagged, so the
   * conflict is visible to promotion and to the metrics dashboard).
   */
  private resolveContradiction(existing: MemoryRecord, candidate: MemoryRecord, reason: string): MemoryMutation {
    const metadata = {
      ...(candidate.metadata || {}),
      conflict_with: existing.id,
      conflict_reason: reason
    };

    if (candidate.updated_at >= existing.updated_at) {
      return {
        decision: "SUPERSEDE",
        previous_id: existing.id,
        memory: { ...candidate, id: createMemoryId(), supersedes: existing.id, metadata }
      };
    }

    return { decision: "ADD", memory: { ...candidate, metadata } };
  }

  /**
   * [P2-2] Conflict pre-check, moved ahead of promotion.
   *
   * Conflicts used to surface only after a memory had already become a rule.
   * Returns a human-readable reason, or null when the two memories can
   * coexist. Only the deterministic detectors run here — `consolidate()` is
   * synchronous, so `hasConflictWithLLM` stays on the promotion path.
   */
  private detectContradiction(existing: MemoryRecord, candidate: MemoryRecord): string | null {
    // 1. Same subject+predicate, different object -> the value changed.
    if (this.changedRelationObject(existing, candidate)) return "relation-object-changed";

    // Identical text cannot contradict itself. Without this guard a single
    // memory containing both halves of a pair ("use the repository layer and
    // avoid raw SQL") would be flagged as opposing itself on re-ingest.
    if (normalizeContent(existing.content) === normalizeContent(candidate.content)) return null;

    const sameSubject = this.conflictResolver.isSameSubject(existing, candidate);
    if (!sameSubject) return null;

    // 2. Opposing obligation ("must" vs "must not", "必须" vs "禁止").
    if (this.conflictResolver.hasOpposingObligation(existing.content, candidate.content)) {
      return "opposing-obligation";
    }

    // 3. Same action, contrastive qualifier ("before" vs "after merging").
    if (this.conflictResolver.hasContrastiveQualifier(existing.content, candidate.content)) {
      return "contrastive-qualifier";
    }

    return null;
  }

  /** True when both share a subject|predicate but disagree on the object. */
  private changedRelationObject(a: MemoryRecord, b: MemoryRecord): boolean {
    const left = new Map((a.relations || []).map(relation => [`${relation.subject}|${relation.predicate}`, relation.object]));
    if (left.size === 0) return false;
    return (b.relations || []).some(relation => {
      const key = `${relation.subject}|${relation.predicate}`;
      return left.has(key) && left.get(key) !== relation.object;
    });
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
