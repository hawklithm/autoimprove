import OpenAI from "openai";
import { Pattern, PatternType, Scene } from "./models.js";
import { SessionData } from "./unified-session-parser.js";
import { LLMConfigManager } from "./llm-config-manager.js";
import { MemoryEntity, MemoryEvidence, MemoryKind, MemoryNamespace, MemoryRecord, MemoryRelation, createMemoryId, InfoClass } from "./memory-models.js";
import { InfoClassifier } from "./info-classifier.js";

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
  info_class?: InfoClass;
  entities?: MemoryEntity[];
  evidence: MemoryEvidence[];
  outcome?: MemoryRecord["outcome"];
}

export class SessionMemoryExtractor {
  private readonly llm = new LLMConfigManager();
  private readonly classifier = new InfoClassifier();

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

    // 关卡联动：用 InfoClassifier 决定认知类别，再据此设定 kind
    const toCandidate = (
      content: string,
      confidence: number,
      importance: number,
      ev: MemoryEvidence[],
      outcome?: MemoryRecord["outcome"]
    ): MemoryCandidate => {
      const cls = this.classifier.classify({ content });
      const infoClass = cls.info_class ?? "experience";
      // experience → procedural（可成规则）；preference/fact → semantic（偏好/上下文）
      const kind: MemoryKind = infoClass === "preference" || infoClass === "fact" ? "semantic" : "procedural";
      return { kind, content, summary: content.slice(0, 240), info_class: infoClass, confidence, importance, evidence: ev, outcome };
    };

    for (const message of messages) {
      if (/\b(prefer|always|never|must|should|喜欢|偏好|必须|不要|统一)\b/i.test(message.content)) {
        candidates.push(toCandidate(
          message.content.trim(),
          0.68,
          0.72,
          [evidence([message.line_number], message.content)]
        ));
      }
    }

    for (const pattern of patterns) {
      candidates.push(toCandidate(
        pattern.description,
        pattern.confidence,
        pattern.priority === "critical" || pattern.priority === "high" ? 0.85 : 0.6,
        pattern.occurrences.map(occurrence => evidence([], occurrence.user_input || pattern.description)),
        { status: "unknown", commands: session.tool_calls.map(tool => tool.tool_name) }
      ));
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
      return parsed.memories.filter((item: any) => item && typeof item.content === "string").map((item: any) => {
        const cls = this.classifier.classify({ content: item.content });
        const infoClass = cls.info_class ?? "experience";
        return {
          kind: item.kind,
          content: item.content,
          summary: item.summary,
          subject: item.subject,
          predicate: item.predicate,
          object: item.object,
          context: item.context,
          info_class: infoClass,
          confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5)),
          importance: Math.max(0, Math.min(1, Number(item.importance) || 0.5)),
          entities: Array.isArray(item.entities) ? item.entities : [],
          evidence: Array.isArray(item.evidence) ? item.evidence : [],
          outcome: item.outcome
        };
      });
    } catch {
      return [];
    }
  }

  private toRecord(candidate: MemoryCandidate, session: SessionData, scene: Scene): MemoryRecord {
    const now = new Date().toISOString();
    const infoClass = candidate.info_class || "experience";
    const relation: MemoryRelation | undefined = candidate.subject && candidate.predicate && candidate.object
      ? { subject: candidate.subject, predicate: candidate.predicate, object: candidate.object, valid_from: now }
      : undefined;
    const namespace: MemoryNamespace = {
      project_path: session.project_path,
      organization_id: session.organization_id || session.metadata?.organization_id || process.env.AUTOIMPROVE_ORGANIZATION_ID,
      repository: session.metadata?.repository,
      branch: session.metadata?.branch,
      session_id: session.session_id
    };
    return {
      id: createMemoryId(),
      kind: candidate.kind,
      content: candidate.content.trim(),
      summary: (candidate.summary || candidate.content).trim().slice(0, 240),
      scene,
      keywords: [],
      info_class: infoClass,
      evidence: candidate.evidence.map(item => ({ ...item, session_id: item.session_id || session.session_id })),
      confidence: candidate.confidence,
      importance: candidate.importance,
      strength: 1,
      created_at: now,
      updated_at: now,
      valid_from: now,
      status: "active",
      // 关卡：fact 只作上下文，不进入 promoted；其余按 kind 区分候选/观察
      state: infoClass === "fact" ? "observed" : (candidate.kind === "procedural" ? "observed" : "candidate"),
      support_count: 1,
      independent_session_count: 1,
      independent_project_count: session.project_path ? 1 : 0,
      validation_count: 0,
      contradiction_count: 0,
      namespace,
      entities: candidate.entities || [],
      relations: relation ? [relation] : [],
      outcome: candidate.outcome,
      metadata: {
        source: "session_memory_extractor",
        context: candidate.context,
        project_paths: session.project_path ? [session.project_path] : [],
        ...(infoClass === "fact" ? { role: "context" } : {})
      }
    };
  }
}
