import { vi, beforeAll, describe, expect, it } from "vitest";
import { MemoryWriteGate, CODE_PATTERNS, BUSINESS_PATTERNS } from "../src/core/memory-write-gate.js";
import { InfoClassifier } from "../src/core/info-classifier.js";
import { createPattern, PatternType, PatternOccurrence, Pattern } from "../src/core/models.js";
import { SessionData } from "../src/core/unified-session-parser.js";

// Ensure the extractor is constructed WITHOUT any LLM config so its `extract()`
// exercises the deterministic heuristic path (no network calls in tests).
let SessionMemoryExtractor: typeof import("../src/core/memory-extractor.js").SessionMemoryExtractor;
let extractor: any;

beforeAll(async () => {
  vi.stubEnv("LLM_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  vi.stubEnv("LLM_BASE_URL", "");
  vi.stubEnv("ANTHROPIC_BASE_URL", "");
  const mod = await import("../src/core/memory-extractor.js");
  SessionMemoryExtractor = mod.SessionMemoryExtractor;
  extractor = new SessionMemoryExtractor();
});

function makePattern(description: string, type: PatternType = PatternType.REPEATED_CORRECTION): Pattern {
  const occ: PatternOccurrence = {
    session_id: "s1",
    timestamp: new Date().toISOString(),
    user_action: "explicit_correction",
    context: "unknown",
    user_input: description,
  };
  return createPattern({
    type,
    description,
    occurrences: [occ],
    first_seen: occ.timestamp,
    last_seen: occ.timestamp,
    confidence: 0.8,
    keywords: [],
  });
}

function makeSession(messages: { role: "user" | "assistant"; content: string }[], patterns: Pattern[]): SessionData {
  return {
    session_id: "test-session",
    messages: messages.map((m, i) => ({ role: m.role, content: m.content, line_number: i + 1 })),
    tool_calls: [],
    metadata: {},
    project_path: "/tmp/project",
  };
}

const emptyScene = { tech: [], functional: [], business: [] };

describe("MemoryWriteGate 第四问 (non-code-content)", () => {
  const gate = new MemoryWriteGate(new InfoClassifier());

  it("exposes CODE_PATTERNS / BUSINESS_PATTERNS dictionaries", () => {
    expect(Array.isArray(CODE_PATTERNS)).toBe(true);
    expect(Array.isArray(BUSINESS_PATTERNS)).toBe(true);
    expect(BUSINESS_PATTERNS.length).toBeGreaterThan(0);
  });

  it("flags pure business content via isBusinessContent", () => {
    expect(gate.isBusinessContent("我们需要招聘一名前端工程师并安排面试")).toBe(true);
    expect(gate.isBusinessContent("Use React and TypeScript for the component")).toBe(false);
  });

  it("rejects business content with reject_reason non-code-content", () => {
    const decision = gate.shouldPersist({
      content: "这个季度营销活动的转化率和获客成本需要优化",
    } as any);
    expect(decision.persist).toBe(false);
    expect(decision.reject_reason).toBe("non-code-content");
  });

  it("still accepts coding-related content", () => {
    const decision = gate.shouldPersist({
      content: "Always use async/await instead of raw promises in Node services",
    } as any);
    expect(decision.persist).toBe(true);
  });
});

describe("SessionMemoryExtractor content filtering", () => {
  it("drops non-code patterns before memory generation", () => {
    const patterns = [makePattern("招聘候选人并安排面试评估"), makePattern("Use useEffect for side effects")];
    const kept = (extractor as any).filterCodePatterns(patterns) as Pattern[];
    expect(kept.length).toBe(1);
    expect(kept[0].description).toContain("useEffect");
  });

  it("produces no memories for a pure business session (heuristic path)", async () => {
    const session = makeSession(
      [{ role: "user", content: "我们团队需要招聘前端工程师，请筛选候选人的简历并安排面试" }],
      [makePattern("招聘候选人并安排面试评估")]
    );
    const memories = await extractor.extract(session, [makePattern("招聘候选人并安排面试评估")], emptyScene);
    expect(memories.length).toBe(0);
  });

  it("still extracts memories for a coding session (heuristic path)", async () => {
    const session = makeSession(
      [{ role: "user", content: "我更喜欢用 TypeScript 写 React 组件，避免 any" }],
      [makePattern("Use TypeScript strict mode in React components")]
    );
    const memories = await extractor.extract(session, [makePattern("Use TypeScript strict mode in React components")], emptyScene);
    expect(memories.length).toBeGreaterThan(0);
    expect(memories.every(m => m.content.length > 0)).toBe(true);
  });

  it("builds an LLM prompt that forbids non-coding content", () => {
    const prompt = (extractor as any).buildPrompt(
      makeSession([{ role: "user", content: "use react" }], []),
      []
    ) as string;
    expect(prompt).toContain("ONLY extract coding-related memories");
    expect(prompt).toContain("marketing");
    expect(prompt).toContain("recruiting");
  });

  it("treats an explicit LLM rejection as empty memories", () => {
    const parsed = (extractor as any).parse('{"rejected": true, "reason": "no coding content"}');
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(0);
  });
});
