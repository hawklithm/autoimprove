import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  KiroSessionExtractor,
  SessionExtractorFactory,
  SessionFormat
} from "../src/core/extractors/index.js";
import { UnifiedSessionParser } from "../src/core/unified-session-parser.js";

describe("Kiro session extraction", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("extracts CLI messages, tool calls, metadata and command history", () => {
    const root = join(tmpdir(), `kiro-cli-${Date.now()}`);
    tempDirs.push(root);
    const cli = join(root, ".kiro", "sessions", "cli");
    mkdirSync(cli, { recursive: true });
    writeFileSync(join(cli, "abc.json"), JSON.stringify({ cwd: "C:/repo", modelId: "kiro-model", agentMode: "autopilot" }));
    writeFileSync(join(cli, "abc.history"), "git status\nnpm test\n");
    writeFileSync(join(cli, "abc.jsonl"), [
      JSON.stringify({ type: "user", timestamp: "2026-07-29T10:00:00Z", message: { role: "user", content: "Fix the auth bug" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "I will inspect it" } }),
      JSON.stringify({ type: "tool_call", name: "read_file", arguments: { path: "src/auth.ts" } }),
      JSON.stringify({ type: "tool_result", call_id: "1", content: "file contents" })
    ].join("\n"));

    const parsed = new UnifiedSessionParser().parseFile(join(cli, "abc.jsonl"));
    expect(SessionExtractorFactory.create("C:\\Users\\test\\.kiro\\sessions\\cli\\abc.jsonl")).toBeInstanceOf(KiroSessionExtractor);
    expect(parsed.session_id).toBe("abc");
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.tool_calls[0].tool_name).toBe("read_file");
    expect(parsed.metadata.cwd).toBe("C:/repo");
    expect(parsed.metadata.command_history).toEqual(["git status", "npm test"]);
  });

  it("extracts IDE messages and session artifacts", () => {
    const root = join(tmpdir(), `kiro-ide-${Date.now()}`);
    tempDirs.push(root);
    const sessionDir = join(root, ".kiro", "sessions", "hash123", "sess_ide-123");
    mkdirSync(join(sessionDir, "snapshots"), { recursive: true });
    writeFileSync(join(sessionDir, "session.json"), JSON.stringify({ cwd: "D:/workspace/app", modelId: "kiro-ide", agentMode: "autopilot" }));
    writeFileSync(join(sessionDir, "publish.cursor"), "cursor-7");
    writeFileSync(join(sessionDir, "snapshots", "001.json"), "{}");
    writeFileSync(join(sessionDir, "messages.json"), JSON.stringify({ messages: [
      { type: "user", content: "Add a test" },
      { type: "assistant", content: "Done" },
      { type: "tool_call", toolName: "write_file", input: { path: "test.ts" } }
    ] }));

    const parsed = new UnifiedSessionParser().parseFile(join(sessionDir, "messages.json"));
    expect(parsed.session_id).toBe("ide-123");
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.tool_calls).toHaveLength(1);
    expect(parsed.project_path).toBe("D:/workspace/app");
    expect(parsed.metadata.workspace_hash).toBe("hash123");
    expect(parsed.metadata.publish_cursor).toBe("cursor-7");
    expect(parsed.metadata.snapshot_files).toEqual(["001.json"]);
  });

  it("exposes Kiro as a supported format", () => {
    expect(SessionFormat.KIRO).toBe("kiro");
    expect(new UnifiedSessionParser().getSupportedFormats()).toContain("kiro");
  });
});
