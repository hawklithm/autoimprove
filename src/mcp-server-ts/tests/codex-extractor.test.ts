/**
 * Integration tests for Codex session extractor.
 * Verifies all 4 critical fixes for Codex format parsing.
 */

import { describe, it, expect } from "vitest";
import { CodexSessionExtractor } from "../src/core/extractors/codex-extractor.js";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("CodexSessionExtractor - Critical Fixes Verification", () => {
  let tempDir: string;
  let extractor: CodexSessionExtractor;

  const setupTest = () => {
    tempDir = mkdtempSync(join(tmpdir(), "codex-test-"));
    extractor = new CodexSessionExtractor();
  };

  const cleanup = () => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };

  const createTestSession = (lines: any[]): string => {
    const filePath = join(tempDir, "rollout-2026-04-11T23-04-49-019d7d12-fba7-70c1-9942-d5b67682a097.jsonl");
    const content = lines.map(line => JSON.stringify(line)).join("\n");
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  };

  describe("FIX 1: Developer role support", () => {
    it("should extract developer (system) messages", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project", cli_version: "1.0.0" },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "developer",
            content: [{ type: "text", text: "You are a helpful assistant." }]
          },
          timestamp: "2026-06-10T10:00:01Z"
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Hello" }]
          },
          timestamp: "2026-06-10T10:00:02Z"
        }
      ]);

  const result = extractor.extract(sessionFile);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toMatchObject({
        role: "system",  // developer maps to system
        content: "You are a helpful assistant."
      });
      expect(result.messages[1]).toMatchObject({
        role: "user",
        content: "Hello"
      });

      cleanup();
    });
  });

  describe("FIX 2: output_text content block support", () => {
    it("should extract assistant messages with output_text blocks", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project" },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Write a function" }]
          },
          timestamp: "2026-06-10T10:00:01Z"
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "Here's the function:" },
              { type: "output_text", text: "function test() { return 42; }" }
            ]
          },
          timestamp: "2026-06-10T10:00:02Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[1]).toMatchObject({
        role: "assistant",
        content: "Here's the function:\nfunction test() { return 42; }"
      });

      cleanup();
    });

    it("should handle mixed content blocks (text + input_text + output_text)", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project" },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              { type: "text", text: "Plain text block" },
              { type: "output_text", text: "Output text block" },
              { type: "input_text", text: "Input text block" }
            ]
          },
          timestamp: "2026-06-10T10:00:01Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      expect(result.messages[0].content).toBe(
        "Plain text block\nOutput text block\nInput text block"
      );

      cleanup();
    });
  });

  describe("FIX 3: function_call extraction (CRITICAL)", () => {
    it("should extract independent function_call items", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project" },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: '{"command": "npm test", "timeout": 30000}'
          },
          timestamp: "2026-06-10T10:00:01Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "read_file",
            arguments: '{"path": "/src/app.ts"}'
          },
          timestamp: "2026-06-10T10:00:02Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      expect(result.tool_calls).toHaveLength(2);

      expect(result.tool_calls[0]).toMatchObject({
        tool_name: "exec_command",
        input: {
          command: "npm test",
          timeout: 30000
        }
      });

      expect(result.tool_calls[1]).toMatchObject({
        tool_name: "read_file",
        input: {
          path: "/src/app.ts"
        }
      });

      cleanup();
    });

    it("should handle malformed function_call arguments gracefully", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project" },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: '{invalid json'  // Malformed JSON
          },
          timestamp: "2026-06-10T10:00:01Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      // Should still extract tool call with raw arguments
      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls[0]).toMatchObject({
        tool_name: "exec_command",
        input: {
          raw: '{invalid json'
        }
      });

      cleanup();
    });

    it("should handle pre-parsed arguments objects", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project" },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: { command: "npm test", timeout: 30000 }  // Already an object
          },
          timestamp: "2026-06-10T10:00:01Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls[0].input).toEqual({
        command: "npm test",
        timeout: 30000
      });

      cleanup();
    });
  });

  describe("FIX 4: function_call_output extraction", () => {
    it("should extract tool execution outputs", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project" },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            arguments: '{"command": "npm test"}'
          },
          timestamp: "2026-06-10T10:00:01Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call_123",
            content: "PASS tests/app.test.ts\n✓ should work (10ms)"
          },
          timestamp: "2026-06-10T10:00:02Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      expect(result.metadata.tool_outputs).toBeDefined();
      expect(result.metadata.tool_outputs["call_123"]).toMatchObject({
        content: "PASS tests/app.test.ts\n✓ should work (10ms)",
        timestamp: "2026-06-10T10:00:02Z"
      });

      cleanup();
    });

    it("should handle multiple tool outputs with different call_ids", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project" },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call_1",
            content: "Output 1"
          },
          timestamp: "2026-06-10T10:00:01Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call_2",
            content: "Output 2"
          },
          timestamp: "2026-06-10T10:00:02Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      expect(Object.keys(result.metadata.tool_outputs)).toHaveLength(2);
      expect(result.metadata.tool_outputs["call_1"].content).toBe("Output 1");
      expect(result.metadata.tool_outputs["call_2"].content).toBe("Output 2");

      cleanup();
    });

    it("should generate fallback call_id when missing", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project" },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            // No call_id
            content: "Test output"
          },
          timestamp: "2026-06-10T10:00:01Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      // Should use line_2 as fallback (line 2 in 1-indexed)
      expect(result.metadata.tool_outputs["line_2"]).toBeDefined();
      expect(result.metadata.tool_outputs["line_2"].content).toBe("Test output");

      cleanup();
    });
  });

  describe("Integration: Complete session with all fixes", () => {
    it("should extract a realistic Codex session with all message types", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: {
            cwd: "/Users/test/project",
            cli_version: "1.5.0",
            originator: "claude-code",
            model_provider: "anthropic"
          },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "developer",
            content: [{ type: "text", text: "System instructions here" }]
          },
          timestamp: "2026-06-10T10:00:01Z"
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "Fix the bug in app.ts" }]
          },
          timestamp: "2026-06-10T10:00:02Z"
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Let me read the file first." }]
          },
          timestamp: "2026-06-10T10:00:03Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "read_file",
            arguments: '{"path": "/Users/test/project/app.ts"}'
          },
          timestamp: "2026-06-10T10:00:04Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call_read_1",
            content: "const x = undefinedVariable; // BUG"
          },
          timestamp: "2026-06-10T10:00:05Z"
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Found the bug, fixing it now." }]
          },
          timestamp: "2026-06-10T10:00:06Z"
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "edit_file",
            arguments: '{"path": "/Users/test/project/app.ts", "old_text": "undefinedVariable", "new_text": "definedVariable"}'
          },
          timestamp: "2026-06-10T10:00:07Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      // Verify all components extracted correctly
      expect(result.session_id).toBe("019d7d12-fba7-70c1-9942-d5b67682a097");
      expect(result.project_path).toBe("/Users/test/project");

      // Check messages (3 total: system + user + 2 assistant)
      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].role).toBe("system");  // developer mapped to system
      expect(result.messages[1].role).toBe("user");
      expect(result.messages[2].role).toBe("assistant");
      expect(result.messages[3].role).toBe("assistant");

      // Check tool calls (2 total: read_file + edit_file)
      expect(result.tool_calls).toHaveLength(2);
      expect(result.tool_calls[0].tool_name).toBe("read_file");
      expect(result.tool_calls[1].tool_name).toBe("edit_file");

      // Check tool outputs
      expect(result.metadata.tool_outputs["call_read_1"]).toBeDefined();
      expect(result.metadata.tool_outputs["call_read_1"].content).toContain("undefinedVariable");

      // Check session metadata
      expect(result.metadata.codex_version).toBe("1.5.0");
      expect(result.metadata.originator).toBe("claude-code");

      cleanup();
    });
  });

  describe("Regression: Existing behavior preserved", () => {
    it("should still extract session_id from filename", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project" },
          timestamp: "2026-06-10T10:00:00Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      // UUID extracted from filename: rollout-2026-04-11T23-04-49-019d7d12-fba7-70c1-9942-d5b67682a097.jsonl
      expect(result.session_id).toBe("019d7d12-fba7-70c1-9942-d5b67682a097");

      cleanup();
    });

    it("should sanitize content with system patterns", () => {
      setupTest();

      const sessionFile = createTestSession([
        {
          type: "session_meta",
          payload: { cwd: "/test/project" },
          timestamp: "2026-06-10T10:00:00Z"
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{
              type: "input_text",
              text: "Base directory for this skill: /foo/bar\n\nActual user message"
            }]
          },
          timestamp: "2026-06-10T10:00:01Z"
        }
      ]);

      const result = extractor.extract(sessionFile);

      // System noise should be stripped
      expect(result.messages[0].content).toBe("Actual user message");
      expect(result.messages[0].content).not.toContain("Base directory");

      cleanup();
    });
  });
});
