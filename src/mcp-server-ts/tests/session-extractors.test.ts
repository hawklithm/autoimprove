/**
 * Tests for session extractors (Claude Code and Codex)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  SessionExtractorFactory,
  SessionFormat,
  ClaudeCodeSessionExtractor,
  CodexSessionExtractor
} from "../src/core/extractors/index.js";
import { UnifiedSessionParser } from "../src/core/unified-session-parser.js";

describe("SessionExtractorFactory", () => {
  describe("format detection", () => {
    it("should detect Claude Code format from path", () => {
      const filePath = "/Users/test/.claude/sessions/test-session.jsonl";
      const extractor = SessionExtractorFactory.create(filePath);
      expect(extractor).toBeInstanceOf(ClaudeCodeSessionExtractor);
    });

    it("should detect Codex format from path", () => {
      const filePath = "/Users/test/.codex/sessions/2026/07/05/rollout-2026-07-05T17-04-12-019f3185-5f4c-7452-806c-d0cd904dcb60.jsonl";
      const extractor = SessionExtractorFactory.create(filePath);
      expect(extractor).toBeInstanceOf(CodexSessionExtractor);
    });

    it("should detect Codex archived sessions", () => {
      const filePath = "/Users/test/.codex/archived_sessions/old-session.jsonl";
      const extractor = SessionExtractorFactory.create(filePath);
      expect(extractor).toBeInstanceOf(CodexSessionExtractor);
    });

    it("should default to Claude Code for unknown paths", () => {
      const filePath = "/tmp/random-session.jsonl";
      const extractor = SessionExtractorFactory.create(filePath);
      expect(extractor).toBeInstanceOf(ClaudeCodeSessionExtractor);
    });
  });

  describe("directory helpers", () => {
    it("should identify Codex session directories", () => {
      expect(SessionExtractorFactory.isCodexSessionDir("/Users/test/.codex/sessions")).toBe(true);
      expect(SessionExtractorFactory.isCodexSessionDir("/Users/test/.codex/archived_sessions")).toBe(true);
      expect(SessionExtractorFactory.isCodexSessionDir("/Users/test/.claude/sessions")).toBe(false);
    });

    it("should identify Claude Code session directories", () => {
      expect(SessionExtractorFactory.isClaudeCodeSessionDir("/Users/test/.claude/sessions")).toBe(true);
      expect(SessionExtractorFactory.isClaudeCodeSessionDir("/Users/test/.claude/archived_sessions")).toBe(true);
      expect(SessionExtractorFactory.isClaudeCodeSessionDir("/Users/test/.codex/sessions")).toBe(false);
    });

    it("should return default session directories", () => {
      const dirs = SessionExtractorFactory.getDefaultSessionDirs();
      expect(dirs.claudeCode).toHaveLength(2);
      expect(dirs.codex).toHaveLength(2);
      expect(dirs.claudeCode[0]).toContain(".claude/sessions");
      expect(dirs.codex[0]).toContain(".codex/sessions");
    });
  });
});

describe("ClaudeCodeSessionExtractor", () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-claude-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    testFilePath = join(tempDir, "test-session.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should extract basic user and assistant messages", () => {
    const sessionData = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Hello, can you help me fix a bug?" },
        timestamp: "2026-07-05T10:00:00Z",
        cwd: "/Users/test/project"
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: "Sure, I can help you with that." },
        timestamp: "2026-07-05T10:00:01Z"
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new ClaudeCodeSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.session_id).toBe("test-session");
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toBe("Hello, can you help me fix a bug?");
    expect(result.messages[1].role).toBe("assistant");
    expect(result.project_path).toBe("/Users/test/project");
  });

  it("should extract tool calls from content blocks", () => {
    const sessionData = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Let me read the file" },
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/test/file.ts" }
            }
          ]
        },
        timestamp: "2026-07-05T10:00:00Z"
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new ClaudeCodeSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].tool_name).toBe("Read");
    expect(result.tool_calls[0].input.file_path).toBe("/test/file.ts");
  });

  it("should sanitize skill system metadata", () => {
    const sessionData = [
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: "Base directory for this skill: /path/to/skill\n\n<command-name>test</command-name>\n\nActual user message"
        },
        timestamp: "2026-07-05T10:00:00Z"
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new ClaudeCodeSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.messages[0].content).toBe("Actual user message");
    expect(result.messages[0].content).not.toContain("Base directory");
    expect(result.messages[0].content).not.toContain("<command-name>");
  });

  it("should handle legacy message format", () => {
    const sessionData = [
      JSON.stringify({
        type: "message",
        role: "user",
        content: "Legacy format message",
        timestamp: "2026-07-05T10:00:00Z"
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new ClaudeCodeSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("Legacy format message");
  });

  it("should skip malformed JSON lines", () => {
    const sessionData = [
      JSON.stringify({ type: "user", message: { role: "user", content: "Valid message" }}),
      "{ invalid json",
      JSON.stringify({ type: "user", message: { role: "user", content: "Another valid message" }})
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new ClaudeCodeSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe("Valid message");
    expect(result.messages[1].content).toBe("Another valid message");
  });

  it("should handle array content format", () => {
    const sessionData = [
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: "First part" },
            { type: "text", text: "Second part" }
          ]
        },
        timestamp: "2026-07-05T10:00:00Z"
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new ClaudeCodeSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.messages[0].content).toBe("First part\nSecond part");
  });
});

describe("CodexSessionExtractor", () => {
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-codex-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    testFilePath = join(tempDir, "rollout-2026-07-05T17-04-12-019f3185-5f4c-7452-806c-d0cd904dcb60.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should extract session metadata", () => {
    const sessionData = [
      JSON.stringify({
        timestamp: "2026-07-05T09:04:12.507Z",
        type: "session_meta",
        payload: {
          id: "019f3185-5f4c-7452-806c-d0cd904dcb60",
          cwd: "/Users/test/workspace/project",
          originator: "codex_cli_rs",
          cli_version: "0.142.5",
          model_provider: "anthropic",
          source: "cli"
        }
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new CodexSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.session_id).toBe("019f3185-5f4c-7452-806c-d0cd904dcb60");
    expect(result.project_path).toBe("/Users/test/workspace/project");
    expect(result.metadata.codex_version).toBe("0.142.5");
    expect(result.metadata.originator).toBe("codex_cli_rs");
    expect(result.metadata.model_provider).toBe("anthropic");
  });

  it("should extract user and assistant messages from response_item", () => {
    const sessionData = [
      JSON.stringify({
        timestamp: "2026-07-05T09:04:15.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Fix the TypeScript error in auth.ts" }
          ]
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-05T09:04:16.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "text", text: "I'll help you fix that error." }
          ]
        }
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new CodexSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toBe("Fix the TypeScript error in auth.ts");
    expect(result.messages[1].role).toBe("assistant");
    expect(result.messages[1].content).toBe("I'll help you fix that error.");
  });

  it("should extract tool calls from response_item payload", () => {
    const sessionData = [
      JSON.stringify({
        timestamp: "2026-07-05T09:04:20.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "text", text: "Let me read the file" },
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/test/auth.ts" }
            }
          ]
        }
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new CodexSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].tool_name).toBe("Read");
    expect(result.tool_calls[0].input.file_path).toBe("/test/auth.ts");
    expect(result.tool_calls[0].timestamp).toBe("2026-07-05T09:04:20.000Z");
  });

  it("should sanitize AGENTS.md instructions from content", () => {
    const sessionData = [
      JSON.stringify({
        timestamp: "2026-07-05T09:04:15.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "# AGENTS.md instructions for /path\n<INSTRUCTIONS>\nLong instructions...\n</INSTRUCTIONS>\n\nActual user request"
            }
          ]
        }
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new CodexSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.messages[0].content).toBe("Actual user request");
    expect(result.messages[0].content).not.toContain("AGENTS.md");
    expect(result.messages[0].content).not.toContain("<INSTRUCTIONS>");
  });

  it("should sanitize environment_context from content", () => {
    const sessionData = [
      JSON.stringify({
        timestamp: "2026-07-05T09:04:15.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "<environment_context>\n  <cwd>/path</cwd>\n</environment_context>\n\nUser message"
            }
          ]
        }
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new CodexSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.messages[0].content).toBe("User message");
    expect(result.messages[0].content).not.toContain("environment_context");
  });

  it("should handle event_item types gracefully", () => {
    const sessionData = [
      JSON.stringify({
        timestamp: "2026-07-05T09:04:20.000Z",
        type: "event_item",
        payload: {
          type: "tool_execution",
          status: "running"
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-05T09:04:21.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Tool completed" }]
        }
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new CodexSessionExtractor();
    const result = extractor.extract(testFilePath);

    // event_item should be skipped, only message should be extracted
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("Tool completed");
  });

  it("should extract session ID from Codex filename format", () => {
    const sessionData = [
      JSON.stringify({
        timestamp: "2026-07-05T09:04:12.507Z",
        type: "session_meta",
        payload: {
          id: "019f3185-5f4c-7452-806c-d0cd904dcb60",
          cwd: "/Users/test/workspace/project",
          originator: "codex_cli_rs"
        }
      })
    ].join("\n");

    writeFileSync(testFilePath, sessionData);

    const extractor = new CodexSessionExtractor();
    const result = extractor.extract(testFilePath);

    expect(result.session_id).toBe("019f3185-5f4c-7452-806c-d0cd904dcb60");
  });
});

describe("UnifiedSessionParser", () => {
  let tempDir: string;
  let claudeFilePath: string;
  let codexFilePath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-unified-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    const claudeDir = join(tempDir, ".claude", "sessions");
    const codexDir = join(tempDir, ".codex", "sessions");
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });

    claudeFilePath = join(claudeDir, "claude-session.jsonl");
    codexFilePath = join(codexDir, "rollout-2026-07-05-019f3185-5f4c-7452-806c-d0cd904dcb60.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should auto-detect and parse Claude Code sessions", () => {
    const sessionData = JSON.stringify({
      type: "user",
      message: { role: "user", content: "Test message" },
      timestamp: "2026-07-05T10:00:00Z"
    });

    writeFileSync(claudeFilePath, sessionData);

    const parser = new UnifiedSessionParser();
    const result = parser.parseFile(claudeFilePath);

    expect(result.session_id).toBe("claude-session");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("Test message");
  });

  it("should auto-detect and parse Codex sessions", () => {
    const sessionData = [
      JSON.stringify({
        timestamp: "2026-07-05T09:04:12.507Z",
        type: "session_meta",
        payload: {
          id: "019f3185-5f4c-7452-806c-d0cd904dcb60",
          cwd: "/test/project",
          originator: "codex_cli_rs"
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-05T09:04:15.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Codex message" }]
        }
      })
    ].join("\n");

    writeFileSync(codexFilePath, sessionData);

    const parser = new UnifiedSessionParser();
    const result = parser.parseFile(codexFilePath);

    expect(result.session_id).toBe("019f3185-5f4c-7452-806c-d0cd904dcb60");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("Codex message");
    expect(result.metadata.originator).toBe("codex_cli_rs");
  });

  it("should return supported formats", () => {
    const parser = new UnifiedSessionParser();
    const formats = parser.getSupportedFormats();

    expect(formats).toContain("claude-code");
    expect(formats).toContain("codex");
  });
});

describe("Integration: Real Codex Session", () => {
  it("should parse real Codex session file from ~/.codex/sessions/", () => {
    const realCodexFile = "/Users/adazhao/.codex/sessions/2026/07/05/rollout-2026-07-05T17-04-12-019f3185-5f4c-7452-806c-d0cd904dcb60.jsonl";

    // Skip if file doesn't exist (CI environment)
    try {
      const parser = new UnifiedSessionParser();
      const result = parser.parseFile(realCodexFile);

      expect(result.session_id).toBe("019f3185-5f4c-7452-806c-d0cd904dcb60");
      expect(result.project_path).toBe("/Users/adazhao/workspace/autoimprove");
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.metadata.originator).toBe("codex-tui");
      expect(result.metadata.codex_version).toBeDefined();
    } catch (error) {
      // Skip test if file not accessible
      console.log("Skipping real Codex session test - file not accessible");
    }
  });
});
