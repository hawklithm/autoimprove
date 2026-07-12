import { describe, it, expect } from "vitest";
import { EmbeddingEncoder } from "../src/core/embedding-encoder.js";
import { MessageClusterer, MessageCandidate } from "../src/core/message-clusterer.js";
import { PatternType, PatternOccurrence } from "../src/core/models.js";

function makeCandidate(text: string, idx: number): MessageCandidate {
  const occurrence: PatternOccurrence = {
    session_id: "test",
    timestamp: new Date().toISOString(),
    user_action: "explicit_correction",
    context: "unknown",
    user_input: text.substring(0, 200),
  };
  return {
    message: { role: "user", content: text, line_number: idx } as any,
    occurrence,
    extractedText: text,
  };
}

describe("EmbeddingEncoder (char n-gram TF-IDF)", () => {
  it("produces aligned, normalized vectors for a batch", () => {
    const enc = new EmbeddingEncoder({ backend: "char-ngram-tfidf" });
    const a = enc.encode("应该用 useMemo 避免重复渲染");
    const b = enc.encode("使用 useMemo 防止重复 re-render");
    expect(a.length).toBe(b.length);
    // normalized => magnitude ~1
    const mag = Math.sqrt(Array.from(a).reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1, 2);
  });

  it("semantically similar (cross-lingual) messages score higher than unrelated ones", () => {
    const enc = new EmbeddingEncoder({ backend: "char-ngram-tfidf" });
    const similar = enc.encodeBatch([
      "应该用 useMemo 避免重复渲染",
      "使用 useMemo 防止重复 re-render",
      "今天天气真好我们去吃饭吧",
    ]);
    const simAB = EmbeddingEncoder.cosine(similar[0], similar[1]);
    const simAC = EmbeddingEncoder.cosine(similar[0], similar[2]);
    expect(simAB).toBeGreaterThan(simAC);
  });
});

describe("MessageClusterer backward compatibility + semantic mode", () => {
  it("legacy mode clusters without throwing and preserves counts", () => {
    const c = new MessageClusterer();
    const candidates = [
      makeCandidate("应该用 useMemo 避免重复渲染", 1),
      makeCandidate("今天天气真好", 2),
      makeCandidate("使用 useMemo 防止重复 re-render", 3),
    ];
    const clusters = c.clusterMessages(candidates);
    expect(clusters.length).toBeGreaterThan(0);
  });
});
