/**
 * Data structure comparison test for Claude Code vs Codex extractors
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ClaudeCodeSessionExtractor, CodexSessionExtractor } from "../src/core/extractors/index.js";
import type { SessionData } from "../src/core/extractors/session-extractor.interface.js";

describe("Data Structure Consistency: Claude Code vs Codex", () => {
  let tempDir: string;
  let claudeFilePath: string;
  let codexFilePath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `test-comparison-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    claudeFilePath = join(tempDir, "claude-session.jsonl");
    codexFilePath = join(tempDir, "codex-session.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should extract identical message structures", () => {
    // Claude Code format
    const claudeData = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Fix the bug" },
        timestamp: "2026-07-05T10:00:00Z",
        cwd: "/test/project"
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: "I'll help you" },
        timestamp: "2026-07-05T10:00:01Z"
      })
    ].join("\n");

    // Codex format
    const codexData = [
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
        timestamp: "2026-07-05T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Fix the bug" }]
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-05T10:00:01Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "I'll help you" }]
        }
      })
    ].join("\n");

    writeFileSync(claudeFilePath, claudeData);
    writeFileSync(codexFilePath, codexData);

    const claudeExtractor = new ClaudeCodeSessionExtractor();
    const codexExtractor = new CodexSessionExtractor();

    const claudeResult = claudeExtractor.extract(claudeFilePath);
    const codexResult = codexExtractor.extract(codexFilePath);

    console.log("\n=== Claude Code Result ===");
    console.log(JSON.stringify(claudeResult, null, 2));
    console.log("\n=== Codex Result ===");
    console.log(JSON.stringify(codexResult, null, 2));

    // Check SessionData structure
    expect(claudeResult).toHaveProperty("session_id");
    expect(claudeResult).toHaveProperty("messages");
    expect(claudeResult).toHaveProperty("tool_calls");
    expect(claudeResult).toHaveProperty("metadata");
    expect(claudeResult).toHaveProperty("project_path");

    expect(codexResult).toHaveProperty("session_id");
    expect(codexResult).toHaveProperty("messages");
    expect(codexResult).toHaveProperty("tool_calls");
    expect(codexResult).toHaveProperty("metadata");
    expect(codexResult).toHaveProperty("project_path");

    // Check message structure consistency
    expect(claudeResult.messages).toHaveLength(2);
    expect(codexResult.messages).toHaveLength(2);

    const claudeMsg = claudeResult.messages[0];
    const codexMsg = codexResult.messages[0];

    // Both should have same fields
    expect(claudeMsg).toHaveProperty("role");
    expect(claudeMsg).toHaveProperty("content");
    expect(claudeMsg).toHaveProperty("timestamp");
    expect(claudeMsg).toHaveProperty("line_number");

    expect(codexMsg).toHaveProperty("role");
    expect(codexMsg).toHaveProperty("content");
    expect(codexMsg).toHaveProperty("timestamp");
    expect(codexMsg).toHaveProperty("line_number");

    // Content should match
    expect(claudeMsg.role).toBe("user");
    expect(codexMsg.role).toBe("user");
    expect(claudeMsg.content).toBe("Fix the bug");
    expect(codexMsg.content).toBe("Fix the bug");

    // Project path should match
    expect(claudeResult.project_path).toBe("/test/project");
    expect(codexResult.project_path).toBe("/test/project");
  });

  it("should extract identical tool call structures", () => {
    // Claude Code format
    const claudeData = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Reading file" },
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/test/file.ts", limit: 100 }
            }
          ]
        },
        timestamp: "2026-07-05T10:00:00Z"
      })
    ].join("\n");

    // Codex format
    const codexData = [
      JSON.stringify({
        timestamp: "2026-07-05T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [
            { type: "text", text: "Reading file" },
            {
              type: "tool_use",
              name: "Read",
              input: { file_path: "/test/file.ts", limit: 100 }
            }
          ]
        }
      })
    ].join("\n");

    writeFileSync(claudeFilePath, claudeData);
    writeFileSync(codexFilePath, codexData);

    const claudeExtractor = new ClaudeCodeSessionExtractor();
    const codexExtractor = new CodexSessionExtractor();

    const claudeResult = claudeExtractor.extract(claudeFilePath);
    const codexResult = codexExtractor.extract(codexFilePath);

    console.log("\n=== Claude Code Tool Calls ===");
    console.log(JSON.stringify(claudeResult.tool_calls, null, 2));
    console.log("\n=== Codex Tool Calls ===");
    console.log(JSON.stringify(codexResult.tool_calls, null, 2));

    // Both should have extracted tool calls
    expect(claudeResult.tool_calls).toHaveLength(1);
    expect(codexResult.tool_calls).toHaveLength(1);

    const claudeTool = claudeResult.tool_calls[0];
    const codexTool = codexResult.tool_calls[0];

    // Check tool call structure
    expect(claudeTool).toHaveProperty("tool_name");
    expect(claudeTool).toHaveProperty("input");
    expect(claudeTool).toHaveProperty("timestamp");
    expect(claudeTool).toHaveProperty("line_number");

    expect(codexTool).toHaveProperty("tool_name");
    expect(codexTool).toHaveProperty("input");
    expect(codexTool).toHaveProperty("timestamp");
    expect(codexTool).toHaveProperty("line_number");

    // Values should match
    expect(claudeTool.tool_name).toBe("Read");
    expect(codexTool.tool_name).toBe("Read");
    expect(claudeTool.input.file_path).toBe("/test/file.ts");
    expect(codexTool.input.file_path).toBe("/test/file.ts");
    expect(claudeTool.input.limit).toBe(100);
    expect(codexTool.input.limit).toBe(100);
  });

  it("should extract metadata with different sources", () => {
    // Claude Code format (no special metadata in format)
    const claudeData = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Test" },
        timestamp: "2026-07-05T10:00:00Z",
        cwd: "/test/project",
        metadata: { custom_field: "value" }
      })
    ].join("\n");

    // Codex format (rich metadata in session_meta)
    const codexData = [
      JSON.stringify({
        timestamp: "2026-07-05T09:04:12.507Z",
        type: "session_meta",
        payload: {
          id: "019f3185-5f4c-7452-806c-d0cd904dcb60",
          cwd: "/test/project",
          originator: "codex_cli_rs",
          cli_version: "0.142.5",
          model_provider: "anthropic",
          source: "cli",
          git: {
            branch: "main",
            commit: "abc123"
          }
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-05T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Test" }]
        }
      })
    ].join("\n");

    writeFileSync(claudeFilePath, claudeData);
    writeFileSync(codexFilePath, codexData);

    const claudeExtractor = new ClaudeCodeSessionExtractor();
    const codexExtractor = new CodexSessionExtractor();

    const claudeResult = claudeExtractor.extract(claudeFilePath);
    const codexResult = codexExtractor.extract(codexFilePath);

    console.log("\n=== Claude Code Metadata ===");
    console.log(JSON.stringify(claudeResult.metadata, null, 2));
    console.log("\n=== Codex Metadata ===");
    console.log(JSON.stringify(codexResult.metadata, null, 2));

    // Claude Code: metadata extraction from message-level metadata field
    // Note: Claude Code format doesn't have centralized session metadata like Codex
    expect(claudeResult.metadata).toEqual({});

    // Codex: rich metadata from session_meta
    expect(codexResult.metadata).toHaveProperty("codex_version");
    expect(codexResult.metadata).toHaveProperty("originator");
    expect(codexResult.metadata).toHaveProperty("model_provider");
    expect(codexResult.metadata).toHaveProperty("source");
    expect(codexResult.metadata).toHaveProperty("git");

    expect(codexResult.metadata.codex_version).toBe("0.142.5");
    expect(codexResult.metadata.originator).toBe("codex_cli_rs");
    expect(codexResult.metadata.model_provider).toBe("anthropic");
  });

  it("should identify missing fields between formats", () => {
    const claudeData = JSON.stringify({
      type: "user",
      message: { role: "user", content: "Test" },
      timestamp: "2026-07-05T10:00:00Z"
    });

    const codexData = [
      JSON.stringify({
        timestamp: "2026-07-05T09:04:12.507Z",
        type: "session_meta",
        payload: {
          id: "019f3185-5f4c-7452-806c-d0cd904dcb60",
          originator: "codex_cli_rs"
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-05T10:00:00Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Test" }]
        }
      })
    ].join("\n");

    writeFileSync(claudeFilePath, claudeData);
    writeFileSync(codexFilePath, codexData);

    const claudeExtractor = new ClaudeCodeSessionExtractor();
    const codexExtractor = new CodexSessionExtractor();

    const claudeResult = claudeExtractor.extract(claudeFilePath);
    const codexResult = codexExtractor.extract(codexFilePath);

    // Analyze field differences
    const claudeFields = {
      hasSessionId: !!claudeResult.session_id,
      hasMessages: claudeResult.messages.length > 0,
      hasToolCalls: claudeResult.tool_calls.length > 0,
      hasMetadata: Object.keys(claudeResult.metadata).length > 0,
      hasProjectPath: !!claudeResult.project_path,
      messageFields: claudeResult.messages[0] ? Object.keys(claudeResult.messages[0]) : [],
      metadataKeys: Object.keys(claudeResult.metadata)
    };

    const codexFields = {
      hasSessionId: !!codexResult.session_id,
      hasMessages: codexResult.messages.length > 0,
      hasToolCalls: codexResult.tool_calls.length > 0,
      hasMetadata: Object.keys(codexResult.metadata).length > 0,
      hasProjectPath: !!codexResult.project_path,
      messageFields: codexResult.messages[0] ? Object.keys(codexResult.messages[0]) : [],
      metadataKeys: Object.keys(codexResult.metadata)
    };

    console.log("\n=== Field Comparison ===");
    console.log("Claude Code Fields:", JSON.stringify(claudeFields, null, 2));
    console.log("Codex Fields:", JSON.stringify(codexFields, null, 2));

    // Core fields should exist in both
    expect(claudeFields.hasSessionId).toBe(true);
    expect(codexFields.hasSessionId).toBe(true);
    expect(claudeFields.hasMessages).toBe(true);
    expect(codexFields.hasMessages).toBe(true);

    // Message structure should be identical
    expect(claudeFields.messageFields).toEqual(codexFields.messageFields);

    // Report metadata differences (expected)
    console.log("\n=== Metadata Differences ===");
    console.log("Claude Code metadata keys:", claudeFields.metadataKeys);
    console.log("Codex metadata keys:", codexFields.metadataKeys);
    console.log("Codex has richer metadata from session_meta payload");
  });

  it("should handle empty sessions consistently", () => {
    const claudeData = ""; // Empty Claude Code session
    const codexData = JSON.stringify({
      timestamp: "2026-07-05T09:04:12.507Z",
      type: "session_meta",
      payload: {
        id: "019f3185-5f4c-7452-806c-d0cd904dcb60",
        originator: "codex_cli_rs"
      }
    }); // Codex session with only metadata

    writeFileSync(claudeFilePath, claudeData);
    writeFileSync(codexFilePath, codexData);

    const claudeExtractor = new ClaudeCodeSessionExtractor();
    const codexExtractor = new CodexSessionExtractor();

    const claudeResult = claudeExtractor.extract(claudeFilePath);
    const codexResult = codexExtractor.extract(codexFilePath);

    console.log("\n=== Empty Claude Code Session ===");
    console.log(JSON.stringify(claudeResult, null, 2));
    console.log("\n=== Empty Codex Session ===");
    console.log(JSON.stringify(codexResult, null, 2));

    // Both should return valid SessionData structure
    expect(claudeResult.messages).toEqual([]);
    expect(claudeResult.tool_calls).toEqual([]);
    expect(codexResult.messages).toEqual([]);
    expect(codexResult.tool_calls).toEqual([]);

    // Both should have required fields
    expect(claudeResult).toHaveProperty("session_id");
    expect(claudeResult).toHaveProperty("metadata");
    expect(codexResult).toHaveProperty("session_id");
    expect(codexResult).toHaveProperty("metadata");
  });
});
