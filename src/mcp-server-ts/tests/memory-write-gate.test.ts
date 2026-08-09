import { describe, expect, it } from "vitest";
import { MemoryWriteGate } from "../src/core/memory-write-gate.js";
import { InfoClassifier } from "../src/core/info-classifier.js";
import { MemoryRecord, createMemoryId } from "../src/core/memory-models.js";

function makeRecord(content: string, infoClass?: "preference" | "fact" | "experience"): MemoryRecord {
  return {
    id: createMemoryId(),
    kind: "procedural",
    content,
    summary: content,
    scene: { tech: [], functional: [], business: [] },
    keywords: [],
    evidence: [],
    confidence: 0.7,
    importance: 0.6,
    strength: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    valid_from: new Date().toISOString(),
    status: "active",
    info_class: infoClass
  } as MemoryRecord;
}

describe("MemoryWriteGate (关卡1)", () => {
  const gate = new MemoryWriteGate(new InfoClassifier());

  it("rejects a one-time request (Q1)", () => {
    const d = gate.shouldPersist(makeRecord("请帮我优化这段代码"));
    expect(d.persist).toBe(false);
    expect(d.reject_reason).toBe("one-time");
  });

  it("rejects a vague request (Q1)", () => {
    const d = gate.shouldPersist(makeRecord("帮我看看这个怎么改"));
    expect(d.persist).toBe(false);
  });

  it("persists a valid experience (Q2/Q3 pass)", () => {
    const d = gate.shouldPersist(makeRecord("应该避免在循环中创建新的对象实例，改为复用对象池以减少 GC 压力", "experience"));
    expect(d.persist).toBe(true);
    expect(d.info_class).toBe("experience");
  });

  it("persists a preference", () => {
    const d = gate.shouldPersist(makeRecord("我们团队约定所有对外 API 都要加超时", "preference"));
    expect(d.persist).toBe(true);
  });

  it("persists a fact as context (classifiable, not one-time)", () => {
    const d = gate.shouldPersist(makeRecord("配置文件位于 config/settings.json", "fact"));
    expect(d.persist).toBe(true);
    expect(d.info_class).toBe("fact");
  });

  it("rejects ephemeral/non-reusable content (Q2)", () => {
    const d = gate.shouldPersist(makeRecord("端口 3000 被占用导致本次构建失败", "experience"));
    expect(d.persist).toBe(false);
    expect(d.reject_reason).toBe("not-reusable");
  });
});
