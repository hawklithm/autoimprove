import { describe, expect, it } from "vitest";
import { MemorySemanticClusterer } from "../src/core/memory-semantic-clusterer.js";
import { MemoryRecord } from "../src/core/memory-models.js";

function makeMemory(partial: Partial<MemoryRecord>): MemoryRecord {
  const now = new Date().toISOString();
  return {
    id: partial.id || "m",
    kind: "procedural",
    content: partial.content || "content",
    summary: partial.summary || partial.content || "summary",
    scene: { tech: [], functional: [], business: [] },
    keywords: partial.keywords || [],
    evidence: partial.evidence || [{ session_id: "s1", message_lines: [1] }],
    confidence: partial.confidence ?? 0.9,
    importance: 0.5,
    strength: partial.strength ?? 3,
    created_at: now,
    updated_at: now,
    valid_from: now,
    status: "active",
    state: "supported",
    independent_session_count: partial.independent_session_count ?? 1,
    independent_project_count: partial.independent_project_count ?? 0,
    validation_count: partial.validation_count ?? 0,
    contradiction_count: partial.contradiction_count ?? 0,
    metadata: partial.metadata || {},
    namespace: partial.namespace || {},
    ...partial,
  };
}

describe("MemorySemanticClusterer", () => {
  it("merges semantically similar create-agent memories into one candidate", () => {
    // Agent memories share near-identical text (same practice described in
    // different sessions) so they exceed the 0.68 similarity threshold.
    const agentText =
      "Procedure to create a new agent: register the agent in the agent registry, configure permissions, then verify registration";
    const memories = [
      makeMemory({
        id: "a1",
        summary: "Procedure to create a new agent",
        content: agentText,
        keywords: ["agent", "create", "registry", "permission"],
        evidence: [{ session_id: "s1", message_lines: [1] }],
        independent_session_count: 1,
      }),
      makeMemory({
        id: "a2",
        summary: "Workflow to create a new agent",
        content: agentText.replace("Procedure to", "Workflow to"),
        keywords: ["agent", "create", "registry", "permission"],
        evidence: [{ session_id: "s2", message_lines: [2] }],
        independent_session_count: 1,
      }),
      makeMemory({
        id: "a3",
        summary: "Steps to create a new agent",
        content: agentText.replace("Procedure to", "Steps to"),
        keywords: ["agent", "create", "registry"],
        evidence: [{ session_id: "s3", message_lines: [3] }],
        independent_session_count: 1,
      }),
      makeMemory({
        id: "b1",
        summary: "登录 API 实现步骤",
        content: "登录 API 实现步骤：先校验参数，再调用认证服务，最后返回 token",
        keywords: ["api", "login", "auth", "token"],
        evidence: [{ session_id: "s4", message_lines: [4] }],
        independent_session_count: 1,
      }),
    ];

    const clusterer = new MemorySemanticClusterer(0.68);
    const clusters = clusterer.clusterSync(memories);
    const agentGroup = clusters.find(c => c.members.some(m => m.id === "a1"));

    expect(agentGroup).toBeDefined();
    expect(agentGroup!.members.length).toBeGreaterThanOrEqual(3);
    // merged candidate aggregates session count so it can pass promotion
    expect(agentGroup!.merged.independent_session_count).toBeGreaterThanOrEqual(3);
    expect(agentGroup!.merged.metadata?.merged_memory_ids).toBeInstanceOf(Array);

    // unrelated API memory should not be merged into the agent group
    expect(agentGroup!.members.some(m => m.id === "b1")).toBe(false);
  });

  it("returns single memory untouched when there is nothing similar", () => {
    const memories = [
      makeMemory({ id: "x1", summary: "Use axios for HTTP requests", content: "Always use axios" }),
      makeMemory({ id: "x2", summary: "登录鉴权流程", content: "登录时先验证 token 再放行", keywords: ["token", "auth"] }),
    ];
    const clusterer = new MemorySemanticClusterer(0.68);
    const clusters = clusterer.clusterSync(memories);
    expect(clusters.length).toBe(2);
    expect(clusters.every(c => c.members.length === 1)).toBe(true);
  });

  it("clusters async path produces same grouping", async () => {
    const agentText =
      "Procedure to create a new agent: register the agent in the agent registry, configure permissions, then verify registration";
    const memories = [
      makeMemory({
        id: "a1",
        summary: "Procedure to create a new agent",
        content: agentText,
        keywords: ["agent", "create", "registry"],
        evidence: [{ session_id: "s1", message_lines: [1] }],
        independent_session_count: 1,
      }),
      makeMemory({
        id: "a2",
        summary: "Workflow to create a new agent",
        content: agentText.replace("Procedure to", "Workflow to"),
        keywords: ["agent", "create", "registry"],
        evidence: [{ session_id: "s2", message_lines: [2] }],
        independent_session_count: 1,
      }),
      makeMemory({
        id: "b1",
        summary: "登录 API 实现步骤",
        content: "登录 API 实现步骤：先校验参数，再调用认证服务，最后返回 token",
        keywords: ["api", "login"],
        evidence: [{ session_id: "s3", message_lines: [3] }],
        independent_session_count: 1,
      }),
    ];
    const clusterer = new MemorySemanticClusterer(0.68);
    const clusters = await clusterer.cluster(memories);
    const group = clusters.find(c => c.members.length === 2);
    expect(group).toBeDefined();
    expect(group!.merged.independent_session_count).toBeGreaterThanOrEqual(2);
  });
});
