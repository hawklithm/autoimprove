import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MemoryStore } from "../storage/memory-store.js";
import { MemoryRecord } from "../core/memory-models.js";
import { MemoryConsolidator } from "../core/memory-consolidator.js";

interface BenchmarkCase {
  name: string;
  query: string;
  relevant: string[];
  projectPath?: string;
}

const root = mkdtempSync(join(tmpdir(), "autoimprove-memory-benchmark-"));
try {
  const store = new MemoryStore(join(root, "memories.jsonl"));
  const now = new Date().toISOString();
  const make = (
    id: string,
    content: string,
    keywords: string[],
    projectPath = "benchmark",
    extras: Partial<MemoryRecord> = {}
  ): MemoryRecord => ({
    id,
    kind: "procedural",
    content,
    summary: content,
    scene: { tech: ["typescript"], functional: ["testing"], business: [] },
    keywords,
    evidence: [{ session_id: "benchmark", message_lines: [1], source_excerpt: content }],
    confidence: 0.9,
    importance: 0.8,
    strength: 3,
    created_at: now,
    updated_at: now,
    valid_from: now,
    status: "active",
    namespace: { project_path: projectPath },
    ...extras
  });

  store.apply({ decision: "ADD", memory: make("m1", "Run TypeScript integration tests before merging", ["typescript", "integration", "tests"]) });
  store.apply({ decision: "ADD", memory: make("m2", "Use repository layer for SQLite access", ["sqlite", "repository", "database"]) });
  store.apply({ decision: "ADD", memory: make("m3", "Never expose tokens in logs", ["security", "tokens", "logs"]) });
  store.apply({ decision: "ADD", memory: make("m4", "提交前必须运行 TypeScript 集成测试", ["typescript", "集成测试", "提交"]) });
  store.apply({ decision: "ADD", memory: make("m5", "Use Redis for session cache", ["redis", "cache", "session"]) });
  store.apply({ decision: "ADD", memory: make("m6", "Run Python unit tests before release", ["python", "unit", "tests"], "other-project") });

  // Contradiction/temporal case: the new memory supersedes the old one.
  const oldRunner = make("m7", "Use Jest for frontend tests", ["frontend", "tests", "runner"], "benchmark", {
    relations: [{ subject: "project", predicate: "test_runner", object: "Jest", valid_from: now }]
  });
  const newRunner = make("m8", "Use Vitest for frontend tests", ["frontend", "tests", "runner"], "benchmark", {
    relations: [{ subject: "project", predicate: "test_runner", object: "Vitest", valid_from: now }]
  });
  store.apply({ decision: "ADD", memory: oldRunner });
  const consolidator = new MemoryConsolidator(store);
  const temporalMutation = consolidator.consolidate(newRunner);
  if (temporalMutation.decision === "SUPERSEDE") store.apply(temporalMutation);
  const currentRunnerId = temporalMutation.memory.id;

  const cases: BenchmarkCase[] = [
    { name: "english procedural", query: "typescript integration testing", relevant: ["m1", "m4"], projectPath: "benchmark" },
    { name: "chinese query", query: "提交前 集成测试", relevant: ["m4", "m1"], projectPath: "benchmark" },
    { name: "repository convention", query: "sqlite data access repository", relevant: ["m2"], projectPath: "benchmark" },
    { name: "security preference", query: "security token logging", relevant: ["m3"], projectPath: "benchmark" },
    { name: "temporal current state", query: "frontend test runner", relevant: [currentRunnerId], projectPath: "benchmark" },
    { name: "project namespace filter", query: "python unit tests", relevant: [], projectPath: "benchmark" }
  ];

  const details = cases.map(test => {
    const results = store.search(test.query, 5, { projectPath: test.projectPath });
    const ids = results.map(result => result.id);
    const firstRelevantRank = test.relevant.length === 0
      ? null
      : ids.findIndex(id => test.relevant.includes(id)) + 1;
    return {
      name: test.name,
      query: test.query,
      expected: test.relevant,
      returned: ids,
      recall_at_1: test.relevant.length > 0 && ids[0] ? test.relevant.includes(ids[0]) : false,
      recall_at_5: test.relevant.length > 0 && ids.some(id => test.relevant.includes(id)),
      reciprocal_rank: firstRelevantRank !== null && firstRelevantRank > 0 ? 1 / firstRelevantRank : 0,
      precision_at_5: test.relevant.length > 0 ? ids.filter(id => test.relevant.includes(id)).length / Math.max(1, ids.length) : 0,
      namespace_isolated: test.name !== "project namespace filter" || !ids.includes("m6")
    };
  });

  const positive = details.filter(item => item.expected.length > 0);
  const temporalPassed = temporalMutation.decision === "SUPERSEDE" &&
    store.list({ activeOnly: true }).some(memory => memory.id === currentRunnerId) &&
    !store.list({ activeOnly: true }).some(memory => memory.id === "m7");
  const irrelevantResults = store.search("graphql websocket", 5);
  const metrics = {
    cases: details.length,
    recall_at_1: positive.filter(item => item.recall_at_1).length / Math.max(1, positive.length),
    recall_at_5: positive.filter(item => item.recall_at_5).length / Math.max(1, positive.length),
    mrr: positive.reduce((sum, item) => sum + item.reciprocal_rank, 0) / Math.max(1, positive.length),
    mean_precision_at_5: positive.reduce((sum, item) => sum + item.precision_at_5, 0) / Math.max(1, positive.length),
    namespace_accuracy: details.filter(item => item.namespace_isolated).length / details.length,
    temporal_contradiction_accuracy: temporalPassed ? 1 : 0,
    irrelevant_suppression: irrelevantResults.length === 0 ? 1 : 0
  };

  console.log(JSON.stringify({ metrics, temporal_decision: temporalMutation.decision, irrelevant_results: irrelevantResults.map(memory => memory.id), details }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
