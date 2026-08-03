import { MemoryRecord } from "./memory-models.js";
import { LLMConfigManager } from "./llm-config-manager.js";

export interface MemoryConflict {
  memory_a_id: string;
  memory_b_id: string;
  reason: string;
  scope_overlap: boolean;
}

/** Lightweight contradiction detector used before promotion and rule evolution. */
export class MemoryConflictResolver {
  private readonly llm = new LLMConfigManager();
  findConflicts(memories: MemoryRecord[]): MemoryConflict[] {
    const conflicts: MemoryConflict[] = [];
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const left = memories[i];
        const right = memories[j];
        if (!this.sameSubject(left, right) || !this.hasOpposingLanguage(left.content, right.content)) continue;
        conflicts.push({ memory_a_id: left.id, memory_b_id: right.id, reason: "Same subject with opposing obligation or preference", scope_overlap: this.scopeOverlaps(left, right) });
      }
    }
    return conflicts;
  }

  hasConflict(memory: MemoryRecord, all: MemoryRecord[]): boolean {
    return this.findConflicts(all.filter(candidate => candidate.id === memory.id || candidate.kind === memory.kind)).some(conflict => conflict.memory_a_id === memory.id || conflict.memory_b_id === memory.id);
  }

  async hasConflictWithLLM(memory: MemoryRecord, all: MemoryRecord[]): Promise<boolean> {
    const candidates = all.filter(candidate => candidate.id !== memory.id && candidate.kind === memory.kind && this.sameSubject(memory, candidate));
    for (const candidate of candidates.slice(0, 5)) {
      const heuristic = this.hasOpposingLanguage(memory.content, candidate.content);
      if (heuristic) return true;
      if (!this.llm.isAvailable()) continue;
      try {
        const prompt = `Determine whether these two durable coding memories are semantically contradictory. Return JSON only: {"conflict":true,"confidence":0.0,"reason":"..."}. Distinguish different scopes or conditional exceptions from true contradictions. A conflict is true only when both prescribe incompatible behavior for overlapping contexts. A: ${memory.content}\nB: ${candidate.content}\nA namespace: ${JSON.stringify(memory.namespace || {})}\nB namespace: ${JSON.stringify(candidate.namespace || {})}`;
        const response = await this.llm.callWithFallback(async (client, model) => client.chat.completions.create({ model, max_tokens: 300, messages: [{ role: "user", content: prompt }] }), { fallbackOnError: true });
        const raw = response.choices[0]?.message?.content || "";
        const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || raw);
        if (parsed.conflict === true && Number(parsed.confidence) >= 0.65) return true;
      } catch {
        // Keep the deterministic detector as the safe fallback.
      }
    }
    return false;
  }

  private sameSubject(a: MemoryRecord, b: MemoryRecord): boolean {
    const aTokens = new Set(`${a.summary} ${a.keywords.join(" ")}`.toLowerCase().split(/[^\p{L}\p{N}_+#.-]+/u).filter(token => token.length > 2));
    const bTokens = new Set(`${b.summary} ${b.keywords.join(" ")}`.toLowerCase().split(/[^\p{L}\p{N}_+#.-]+/u).filter(token => token.length > 2));
    const overlap = [...aTokens].filter(token => bTokens.has(token)).length / Math.max(1, Math.min(aTokens.size, bTokens.size));
    return overlap >= 0.5;
  }

  private hasOpposingLanguage(a: string, b: string): boolean {
    const left = a.toLowerCase();
    const right = b.toLowerCase();
    const pairs = [["must", "must not"], ["always", "never"], ["use", "avoid"], ["should", "should not"], ["必须", "禁止"], ["应该", "不要"], ["统一使用", "禁止使用"]];
    return pairs.some(([positive, negative]) => (left.includes(positive) && right.includes(negative)) || (left.includes(negative) && right.includes(positive)));
  }

  private scopeOverlaps(a: MemoryRecord, b: MemoryRecord): boolean {
    const projectA = a.namespace?.project_path;
    const projectB = b.namespace?.project_path;
    if (projectA && projectB) return projectA.replace(/\\/g, "/").toLowerCase() === projectB.replace(/\\/g, "/").toLowerCase();
    return !projectA || !projectB;
  }
}
