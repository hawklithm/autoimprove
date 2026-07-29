import OpenAI from "openai";
import { Pattern, PatternType, Scene } from "./models.js";
import { SessionData } from "./unified-session-parser.js";
import { LLMConfigManager } from "./llm-config-manager.js";
import { MemoryEntity, MemoryEvidence, MemoryKind, MemoryNamespace, MemoryRecord, MemoryRelation, createMemoryId } from "./memory-models.js";

export interface MemoryCandidate {
  kind: MemoryKind;
  content: string;
  summary?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  context?: string;
  confidence: number;
  importance: number;
  entities?: MemoryEntity[];
  evidence: MemoryEvidence[];
  outcome?: MemoryRecord["outcome"];
}

export class SessionMemoryExtractor {
  private readonly llm = new LLMConfigManager();

  async extract(session: SessionData, patterns: Pattern[], scene: Scene): Promise<MemoryRecord[]> {
    const heuristic = this.heuristicCandidates(session, patterns);
    if (!this.llm.isAvailable()) return heuristic.map(candidate => this.toRecord(candidate, session, scene));

    try {
      const prompt = this.buildPrompt(session, patterns);
      const response = await this.llm.callWithFallback(async (client, model) => client.chat.completions.create({
        model,
        max_tokens: 2200,
        messages: [{ role: "user", content: prompt }]
      }), { fallbackOnError: true });
      const parsed = this.parse(response.choices[0]?.message?.content || "");
      const candidates = parsed.length > 0 ? parsed : heuristic;
      return candidates.map(candidate => this.toRecord(candidate, session, scene));
    } catch {
      return heuristic.map(candidate => this.toRecord(candidate, session, scene));
    }
  }

  private heuristicCandidates(session: SessionData, patterns: Pattern[]): MemoryCandidate[] {
    const candidates: MemoryCandidate[] = [];
    const messages = session.messages.filter(message => message.content.trim());
    const evidence = (messageLines: number[], excerpt: string): MemoryEvidence => ({
      session_id: session.session_id,
      message_lines: messageLines,
      tool_names: session.tool_calls.map(tool => tool.tool_name),
      source_excerpt: excerpt.slice(0, 500)
    });

    for (const message of messages) {
      if (/\b(prefer|always|never|must|should|喜欢|偏好|必须|不要|统一)\b/i.test(message.content)) {
        candidates.push({
          kind: "semantic",
          content: message.content.trim(),
          summary: message.content.trim().slice(0, 240),
          confidence: 0.68,
          importance: 0.72,
          evidence: [evidence([message.line_number], message.content)]
        });
      }
    }

    for (const pattern of patterns) {
      candidates.push({
        kind: "procedural",
        content: pattern.description,
        summary: pattern.description.slice(0, 240),
        confidence: pattern.confidence,
        importance: pattern.priority === "critical" || pattern.priority === "high" ? 0.85 : 0.6,
        evidence: pattern.occurrences.map(occurrence => evidence([], occurrence.user_input || pattern.description)),
        outcome: { status: "unknown", commands: session.tool_calls.map(tool => tool.tool_name) }
      });
    }
    return candidates;
  }

  private buildPrompt(session: SessionData, patterns: Pattern[]): string {
    const transcript = session.messages.slice(-60).map(message => `${message.role}: ${message.content.slice(0, 700)}`).join("\n");
    return `Extract durable memories from this coding-agent session. Return JSON only.
Separate semantic facts/preferences, episodic decisions/outcomes, and procedural rules.
Only keep information useful in future sessions. Preserve context so each item is understandable alone.
Schema: {"memories":[{"kind":"semantic|episodic|procedural","content":"...","summary":"...","subject":"...","predicate":"...","object":"...","context":"...","confidence":0.0,"importance":0.0,"entities":[{"id":"...","name":"...","type":"project|file|technology|tool|concept|user|unknown"}],"evidence":[{"message_lines":[],"source_excerpt":"..."}],"outcome":{"status":"success|partial|failed|unknown","tests_passed":true} }]}
Session: ${session.session_id}
Transcript:\n${transcript}
Detected patterns:\n${patterns.map(pattern => `${pattern.type}: ${pattern.description}`).join("\n")}`;
  }

  private parse(response: string): MemoryCandidate[] {
    try {
      const match = response.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(match ? match[0] : response);
      if (!Array.isArray(parsed.memories)) return [];
      return parsed.memories.filter((item: any) => item && typeof item.content === "string").map((item: any) => ({
        kind: item.kind,
        content: item.content,
        summary: item.summary,
        subject: item.subject,
        predicate: item.predicate,
        object: item.object,
        context: item.context,
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
        importance: Math.max(0, Math.min(1, Number(item.importance) || 0.5)),
        entities: Array.isArray(item.entities) ? item.entities : [],
        evidence: Array.isArray(item.evidence) ? item.evidence : [],
        outcome: item.outcome
      }));
    } catch {
      return [];
    }
  }

  private toRecord(candidate: MemoryCandidate, session: SessionData, scene: Scene): MemoryRecord {
    const now = new Date().toISOString();
    const relation: MemoryRelation | undefined = candidate.subject && candidate.predicate && candidate.object
      ? { subject: candidate.subject, predicate: candidate.predicate, object: candidate.object, valid_from: now }
      : undefined;
    const namespace: MemoryNamespace = { project_path: session.project_path, session_id: session.session_id };
    return {
      id: createMemoryId(),
      kind: candidate.kind,
      content: candidate.content.trim(),
      summary: (candidate.summary || candidate.content).trim().slice(0, 240),
      scene,
      keywords: [],
      evidence: candidate.evidence.map(item => ({ ...item, session_id: item.session_id || session.session_id })),
      confidence: candidate.confidence,
      importance: candidate.importance,
      strength: 1,
      created_at: now,
      updated_at: now,
      valid_from: now,
      status: "active",
      namespace,
      entities: candidate.entities || [],
      relations: relation ? [relation] : [],
      outcome: candidate.outcome,
      metadata: { source: "session_memory_extractor", context: candidate.context }
    };
  }
}
