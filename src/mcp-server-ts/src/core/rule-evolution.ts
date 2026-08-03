import { RuleIndexEntry } from "./models.js";
import { RuleQualityController } from "./rule-quality.js";
import { MemoryRepository } from "./memory-models.js";
import { RuleIndexManager } from "../storage/rule-index.js";
import { RuleContentManager } from "../storage/rule-content.js";

export type RuleFeedbackKind = "recalled" | "applied" | "accepted" | "validated" | "ignored" | "corrected" | "contradicted" | "disabled";

/** Recomputes rule state from its source memories and usage feedback. */
export class RuleEvolutionService {
  constructor(private readonly indexManager: RuleIndexManager, private readonly contentManager: RuleContentManager, private readonly memoryStore: MemoryRepository, private readonly qualityController = new RuleQualityController()) {}

  recordFeedback(ruleId: string, feedback: RuleFeedbackKind): RuleIndexEntry | undefined {
    const rule = this.indexManager.getRule(ruleId);
    if (!rule) return undefined;
    const now = new Date().toISOString();
    this.indexManager.updateRule(ruleId, {
      usage_count: (rule.usage_count || 0) + (feedback === "recalled" || feedback === "applied" ? 1 : 0),
      acceptance_count: (rule.acceptance_count || 0) + (feedback === "accepted" || feedback === "validated" ? 1 : 0),
      correction_count: (rule.correction_count || 0) + (feedback === "corrected" || feedback === "ignored" ? 1 : 0),
      contradiction_count: (rule.contradiction_count || 0) + (feedback === "contradicted" ? 1 : 0),
      last_applied_at: feedback === "applied" ? now : rule.last_applied_at,
      last_validated_at: feedback === "validated" || feedback === "accepted" ? now : rule.last_validated_at,
      status: feedback === "disabled" ? "disabled" : feedback === "contradicted" ? "deprecated" : rule.status || "active"
    });
    return this.reevaluateRule(ruleId);
  }

  reevaluateAll(): number {
    let count = 0;
    for (const rule of this.indexManager.getAllRules()) {
      if (this.reevaluateRule(rule.id)) count++;
    }
    return count;
  }

  reevaluateRule(ruleId: string): RuleIndexEntry | undefined {
    const rule = this.indexManager.getRule(ruleId);
    const content = rule ? this.contentManager.loadContent(ruleId) : undefined;
    if (!rule || !content) return undefined;
    const memories = this.memoryStore.list({ activeOnly: false }).filter(memory => rule.source_memory_ids?.includes(memory.id));
    const support = this.calculateMemorySupport(memories);
    const score = this.qualityController.assessUnifiedScore(content, rule, content.metadata?.evidence_confidence ?? rule.confidence, content.metadata?.scope_confidence ?? rule.scope_confidence ?? 0.5, support);
    const hasContradiction = memories.some(memory => (memory.contradiction_count || 0) > 0 || memory.state === "deprecated");
    const accepted = (rule.acceptance_count || 0) > 0 || memories.some(memory => (memory.validation_count || 0) > 0 || memory.state === "validated" || memory.state === "promoted");
    const status = rule.status === "disabled" || rule.status === "archived" ? rule.status : hasContradiction && !accepted ? "deprecated" : score.overall < 0.45 ? "deprecated" : accepted ? "active" : rule.status || "candidate";
    const updated = { ...rule, confidence: score.overall, status };
    this.indexManager.replaceRule(ruleId, updated);
    content.metadata = { ...content.metadata, confidence: score.overall, quality_score: score.overall, memory_support_score: score.memory_support_score, lifecycle_reason: hasContradiction ? "source memory contradiction" : accepted ? "validated by feedback or outcome" : "candidate awaiting validation" };
    this.contentManager.saveContent(content);
    return updated;
  }

  private calculateMemorySupport(memories: Array<{ confidence: number; importance: number; strength: number; state?: string; validation_count?: number; contradiction_count?: number; outcome?: { status?: string } }>): number {
    if (memories.length === 0) return 0.5;
    return Math.max(0, Math.min(1, memories.reduce((sum, memory) => {
      const validation = Math.min(1, (memory.validation_count || 0) / 3);
      const contradiction = Math.min(1, (memory.contradiction_count || 0) / 2);
      const outcome = memory.outcome?.status === "success" ? 1 : memory.outcome?.status === "failed" ? 0 : 0.5;
      return sum + memory.confidence * 0.3 + Math.min(1, memory.strength / 5) * 0.2 + memory.importance * 0.1 + validation * 0.25 + outcome * 0.15 - contradiction * 0.25;
    }, 0) / memories.length));
  }
}
