import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { MemoryMutation, MemoryRecord, MemorySearchResult, MemoryUsageEvent, MemoryRuleLink, MemorySearchFilters } from "../core/memory-models.js";
import { STORAGE_ROOT } from "./init.js";

function charNgrams(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  const result = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i++) result.add(normalized.slice(i, i + 2));
  return result;
}

function charSimilarity(a: string, b: string): number {
  const left = charNgrams(a);
  const right = charNgrams(b);
  if (!left.size || !right.size) return 0;
  return [...left].filter(item => right.has(item)).length / new Set([...left, ...right]).size;
}

export class MemoryStore {
  private readonly path: string;
  private records = new Map<string, MemoryRecord>();

  constructor(filePath = join(STORAGE_ROOT, "memories", "memories.jsonl")) {
    this.path = filePath;
    mkdirSync(dirname(this.path), { recursive: true });
    this.load();
  }

  list(options: { activeOnly?: boolean; kind?: MemoryRecord["kind"]; projectPath?: string; organizationId?: string; repository?: string; branch?: string } = {}): MemoryRecord[] {
    return Array.from(this.records.values()).filter(record =>
      (!options.activeOnly || record.status === "active") &&
      (!options.kind || record.kind === options.kind) &&
      (!options.projectPath || !record.namespace?.project_path || record.namespace.project_path === options.projectPath) &&
      (!options.organizationId || !record.namespace?.organization_id || record.namespace.organization_id.toLowerCase() === options.organizationId.toLowerCase())
      && (!options.repository || !record.namespace?.repository || record.namespace.repository === options.repository)
      && (!options.branch || !record.namespace?.branch || record.namespace.branch === options.branch)
    );
  }

  search(query: string, limit = 8, filters: MemorySearchFilters = {}): MemoryRecord[] {
    return this.searchScored(query, limit, filters).map(result => result.memory);
  }

  searchScored(query: string, limit = 8, filters: MemorySearchFilters = {}): MemorySearchResult[] {
    const queryTokens = new Set(query.toLowerCase().split(/[^\p{L}\p{N}_+#.-]+/u).filter(Boolean));
    return this.list({ activeOnly: true, ...filters })
      .map(memory => {
        const haystack = `${memory.content} ${memory.summary} ${memory.keywords.join(" ")} ${memory.scene.tech.join(" ")} ${memory.scene.functional.join(" ")} ${(memory.entities || []).map(entity => entity.name).join(" ")} ${(memory.relations || []).map(relation => `${relation.subject} ${relation.predicate} ${relation.object}`).join(" ")}`.toLowerCase();
        const matched = [...queryTokens].filter(token => haystack.includes(token)).length;
        const lexical = matched / Math.max(1, queryTokens.size);
        const entityMatches = (memory.entities || []).filter(entity => [...queryTokens].some(token => entity.name.toLowerCase().includes(token))).length;
        const semantic = charSimilarity(query, `${memory.content} ${memory.summary}`);
        const recency = Math.max(0, 1 - (Date.now() - Date.parse(memory.updated_at)) / (1000 * 60 * 60 * 24 * 30));
        const outcomeBoost = memory.outcome?.status === "success" || memory.outcome?.tests_passed ? 1 : 0;
        const validationBoost = Math.min(1, (memory.validation_count || 0) / 3);
        const contradictionPenalty = Math.min(1, (memory.contradiction_count || 0) / 2);
        const score = semantic * 0.22 + lexical * 0.25 + Math.min(1, entityMatches / Math.max(1, queryTokens.size)) * 0.12 + memory.importance * 0.12 + memory.confidence * 0.12 + Math.min(1, memory.strength / 5) * 0.08 + validationBoost * 0.06 + recency * 0.03 + outcomeBoost * 0.02 - contradictionPenalty * 0.12;
        const reasons: string[] = [];
        if (lexical > 0) reasons.push(`keyword:${lexical.toFixed(2)}`);
        if (entityMatches > 0) reasons.push(`entity:${entityMatches}`);
        if (semantic >= 0.18) reasons.push(`char-semantic:${semantic.toFixed(2)}`);
        if (outcomeBoost > 0) reasons.push("validated-outcome");
        return { memory, score, reasons };
      })
      // Importance/recency must not make an unrelated memory appear relevant.
      // Require at least one retrieval signal before applying quality boosts.
      .filter(item => item.score > 0.12 && item.reasons.some(reason => reason.startsWith("keyword:") || reason.startsWith("entity:") || reason.startsWith("char-semantic:")))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  apply(mutation: MemoryMutation): MemoryRecord {
    const record = mutation.memory;
    if (mutation.previous_id && mutation.decision === "SUPERSEDE") {
      const previous = this.records.get(mutation.previous_id);
      if (previous) {
        previous.status = "superseded";
        previous.valid_to = record.valid_from;
        previous.updated_at = record.updated_at;
        this.append(previous);
      }
    }
    this.records.set(record.id, record);
    this.append(record);
    return record;
  }

  recordUsage(memoryId: string, event: MemoryUsageEvent): void {
    const record = this.records.get(memoryId);
    if (!record) return;
    const delta = event === "rejected" || event === "corrected" || event === "contradicted" ? -0.5 : 0.5;
    record.strength = Math.max(0, record.strength + delta);
    record.validation_count = (record.validation_count || 0) + (event === "validated" || event === "accepted" ? 1 : 0);
    record.contradiction_count = (record.contradiction_count || 0) + (event === "contradicted" || event === "corrected" ? 1 : 0);
    if (event === "validated" || event === "accepted") {
      record.state = "validated";
      record.last_validated_at = new Date().toISOString();
    } else if (event === "contradicted" || event === "corrected") {
      record.state = "deprecated";
    }
    record.updated_at = new Date().toISOString();
    record.metadata = { ...(record.metadata || {}), [`usage_${event}`]: Number(record.metadata?.[`usage_${event}`] || 0) + 1 };
    this.append(record);
  }

  linkRule(link: MemoryRuleLink): void {
    const record = this.records.get(link.memory_id);
    if (!record) return;
    const links = Array.isArray(record.metadata?.linked_rule_links) ? record.metadata.linked_rule_links as MemoryRuleLink[] : [];
    const next = links.filter(item => item.rule_id !== link.rule_id);
    next.push(link);
    record.metadata = { ...(record.metadata || {}), linked_rule_links: next };
    record.updated_at = link.updated_at;
    this.append(record);
  }

  getRulesForMemory(memoryId: string): MemoryRuleLink[] {
    const record = this.records.get(memoryId);
    return Array.isArray(record?.metadata?.linked_rule_links) ? record!.metadata!.linked_rule_links as MemoryRuleLink[] : [];
  }

  getMemoriesForRule(ruleId: string): MemoryRuleLink[] {
    return this.list().flatMap(record => this.getRulesForMemory(record.id).filter(link => link.rule_id === ruleId));
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    for (const line of readFileSync(this.path, "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as MemoryRecord;
        if (record.id) this.records.set(record.id, record);
      } catch {
        // Ignore a partial/corrupt trailing line so one bad record does not
        // make the entire memory store unavailable.
      }
    }
  }

  private append(record: MemoryRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }

  compact(): void {
    writeFileSync(this.path, this.list().map(record => JSON.stringify(record)).join("\n") + "\n", "utf8");
  }

  /** 重读持久化文件并刷新内存 Map。用于其他实例/进程已写入记忆后，让本实例看到最新数据。 */
  reload(): void {
    this.records.clear();
    this.load();
  }
}
