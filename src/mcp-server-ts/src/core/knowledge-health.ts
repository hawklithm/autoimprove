import { RuleIndexManager } from "../storage/rule-index.js";
import { MemoryRepository } from "./memory-models.js";

export class KnowledgeHealthAnalyzer {
  constructor(private readonly indexManager: RuleIndexManager, private readonly memoryStore: MemoryRepository) {}

  getReport() {
    const rules = this.indexManager.getAllRules();
    const memories = this.memoryStore.list({ activeOnly: false });
    const activeMemories = memories.filter(memory => memory.status === "active");
    const linkedRules = rules.filter(rule => (rule.source_memory_ids || []).length > 0);
    const totalUsage = rules.reduce((sum, rule) => sum + (rule.usage_count || 0), 0);
    const totalAccepted = rules.reduce((sum, rule) => sum + (rule.acceptance_count || 0), 0);
    const totalCorrections = rules.reduce((sum, rule) => sum + (rule.correction_count || 0), 0);
    return {
      generated_at: new Date().toISOString(),
      memories: {
        total: memories.length,
        active: activeMemories.length,
        by_kind: this.group(memories.map(memory => memory.kind)),
        by_state: this.group(memories.map(memory => memory.state || "candidate")),
        validation_count: memories.reduce((sum, memory) => sum + (memory.validation_count || 0), 0),
        contradiction_count: memories.reduce((sum, memory) => sum + (memory.contradiction_count || 0), 0)
      },
      rules: {
        total: rules.length,
        by_status: this.group(rules.map(rule => rule.status || "active")),
        linked_to_memory: linkedRules.length,
        memory_link_rate: rules.length ? linkedRules.length / rules.length : 0,
        average_confidence: rules.length ? rules.reduce((sum, rule) => sum + rule.confidence, 0) / rules.length : 0,
        usage_count: totalUsage,
        acceptance_count: totalAccepted,
        correction_count: totalCorrections,
        acceptance_rate: totalUsage ? totalAccepted / totalUsage : 0,
        correction_rate: totalUsage ? totalCorrections / totalUsage : 0
      }
    };
  }

  private group(values: string[]): Record<string, number> {
    return values.reduce<Record<string, number>>((result, value) => {
      result[value] = (result[value] || 0) + 1;
      return result;
    }, {});
  }
}
