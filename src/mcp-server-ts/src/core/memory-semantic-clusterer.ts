/**
 * Memory Semantic Clusterer — merges semantically-similar procedural memories
 * before promotion (P3).
 *
 * Problem: many procedural memories carry `independent_session_count = 1`
 * (they appear in a single session), so each individually fails the promotion
 * frequency gate even when several of them describe the same underlying
 * practice. This clusterer groups memories whose embeddings are similar
 * (cosine >= threshold) and merges their session/project/evidence counts so
 * the aggregated memory can qualify for promotion.
 */

import { MemoryRecord, MemoryEvidence } from "./memory-models.js";
import { EmbeddingEncoder } from "./embedding-encoder.js";
import { logger } from "./logger.js";

export interface SemanticCluster {
  /** Representative memory with merged session/project/evidence counts. */
  merged: MemoryRecord;
  /** Original member memories (for traceability). */
  members: MemoryRecord[];
}

export class MemorySemanticClusterer {
  private readonly encoder: EmbeddingEncoder;
  /**
   * @param similarityThreshold - Cosine similarity above which two memories are
   * "same topic". Calibrated on the real memory store with the char-ngram-tfidf
   * backend: 0.75 misses real same-topic pairs (hire-agent memories score
   * 0.58-0.72), while 0.6 over-merges template-heavy text. 0.68 captures the
   * hire-agent cluster while keeping most template-noise apart.
   */
  constructor(private readonly similarityThreshold: number = 0.68) {
    this.encoder = new EmbeddingEncoder({ backend: "char-ngram-tfidf" });
  }

  /** Text used for embedding: content + summary + keywords carry the topic signal. */
  private textOf(memory: MemoryRecord): string {
    return [memory.content, memory.summary, ...(memory.keywords || [])]
      .filter(Boolean)
      .join(" ");
  }

  /**
   * Group memories by semantic similarity (async, batch-encodes for full IDF).
   */
  async cluster(memories: MemoryRecord[]): Promise<SemanticCluster[]> {
    if (memories.length <= 1) {
      return memories.map(memory => ({ merged: memory, members: [memory] }));
    }
    const texts = memories.map(memory => this.textOf(memory));
    const vectors = await this.encoder.encodeBatch(texts);
    return this.group(memories, vectors);
  }

  /**
   * Group memories by semantic similarity using the synchronous encoder
   * (usable from sync promotion paths; IDF is less accurate but fine for
   * pairwise similarity grouping).
   */
  clusterSync(memories: MemoryRecord[]): SemanticCluster[] {
    if (memories.length <= 1) {
      return memories.map(memory => ({ merged: memory, members: [memory] }));
    }
    const vectors = memories.map(memory => this.encoder.encodeSync(this.textOf(memory)));
    return this.group(memories, vectors);
  }

  /** Greedy grouping: chain anything above threshold onto the first ungrouped item. */
  private group(memories: MemoryRecord[], vectors: Float32Array[]): SemanticCluster[] {
    const n = memories.length;
    const visited = new Array<boolean>(n).fill(false);
    const clusters: SemanticCluster[] = [];

    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      visited[i] = true;
      const members: MemoryRecord[] = [memories[i]];
      for (let j = i + 1; j < n; j++) {
        if (visited[j]) continue;
        const sim = EmbeddingEncoder.cosine(vectors[i], vectors[j]);
        if (sim >= this.similarityThreshold) {
          members.push(memories[j]);
          visited[j] = true;
        }
      }
      clusters.push({
        merged: members.length > 1 ? this.merge(members) : members[0],
        members,
      });
      if (members.length > 1) {
        logger.info("memory-semantic-clusterer", `Merged ${members.length} semantically similar memories into one promotion candidate`, {
          threshold: this.similarityThreshold,
          memberIds: members.map(m => m.id),
        });
      }
    }
    return clusters;
  }

  /**
   * Merge member memories into a representative that aggregates
   * session/project/evidence counts. The representative takes the highest
   * confidence member as its base so its content/summary stay coherent.
   */
  private merge(members: MemoryRecord[]): MemoryRecord {
    const representative = [...members].sort((a, b) => b.confidence - a.confidence)[0];

    const sessionIds = new Set<string>();
    const projectPaths = new Set<string>();
    const evidenceMap = new Map<string, MemoryEvidence>();

    for (const member of members) {
      for (const evidence of member.evidence || []) {
        sessionIds.add(evidence.session_id);
        // Deduplicate evidence by session + line signature.
        const key = `${evidence.session_id}:${(evidence.message_lines || []).join(",")}`;
        if (!evidenceMap.has(key)) evidenceMap.set(key, evidence);
      }
      if (member.namespace?.project_path) projectPaths.add(member.namespace.project_path);
      for (const path of member.metadata?.project_paths as string[] | undefined || []) {
        if (path) projectPaths.add(path);
      }
    }

    const merged: MemoryRecord = {
      ...representative,
      evidence: [...evidenceMap.values()],
      independent_session_count: Math.max(
        sessionIds.size,
        ...members.map(m => m.independent_session_count || 0)
      ),
      independent_project_count: Math.max(
        projectPaths.size,
        ...members.map(m => m.independent_project_count || 0)
      ),
      validation_count: members.reduce((sum, m) => sum + (m.validation_count || 0), 0),
      contradiction_count: Math.max(...members.map(m => m.contradiction_count || 0)),
      strength: Math.max(...members.map(m => m.strength || 0)),
      confidence: Math.max(...members.map(m => m.confidence || 0)),
      keywords: Array.from(new Set(members.flatMap(m => m.keywords || []))),
      metadata: {
        ...(representative.metadata || {}),
        merged_memory_ids: members.map(m => m.id),
        merged_memory_count: members.length,
      },
    };

    return merged;
  }
}
