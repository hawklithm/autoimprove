/**
 * Kiro CLI and IDE session extractor.
 *
 * Supported layouts:
 *   ~/.kiro/sessions/cli/<uuid>.jsonl (+ <uuid>.json / <uuid>.history)
 *   ~/.kiro/sessions/<workspace-hash>/sess_<uuid>/messages.json
 *     (+ session.json, publish.cursor, snapshots/)
 *
 * Kiro has changed event envelopes between CLI/IDE releases, so this
 * extractor deliberately accepts the common role/type/content variants and
 * preserves unknown metadata instead of discarding it.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, dirname, join } from "path";
import { SessionExtractor, Message, ToolCall, SessionData } from "./session-extractor.interface.js";
import { logger } from "../logger.js";

export class KiroSessionExtractor extends SessionExtractor {
  extract(filePath: string): SessionData {
    const normalized = filePath.replace(/\\/g, "/");
    const sessionFile = this.resolveSessionFile(filePath);
    const sessionDir = this.resolveSessionDir(filePath, sessionFile);
    const messages: Message[] = [];
    const toolCalls: ToolCall[] = [];
    const metadata: Record<string, any> = {
      source: "kiro",
      kiro_layout: normalized.includes("/cli/") ? "cli" : "ide",
      source_file: sessionFile
    };

    this.mergeJsonMetadata(join(dirname(sessionFile), `${this.extractSessionId(sessionFile)}.json`), metadata);
    this.mergeJsonMetadata(join(sessionDir, "session.json"), metadata);

    const raw = readFileSync(sessionFile, "utf8");
    if (sessionFile.toLowerCase().endsWith(".jsonl")) {
      raw.split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return;
        try {
          this.processRecord(JSON.parse(line), index + 1, messages, toolCalls, metadata);
        } catch (error) {
          this.handleParseError(error, index + 1);
        }
      });
    } else {
      try {
        const parsed = JSON.parse(raw);
        const records = this.unwrapRecords(parsed);
        records.forEach((record, index) => this.processRecord(record, index + 1, messages, toolCalls, metadata));
      } catch (error) {
        this.handleParseError(error, 1);
      }
    }

    this.loadHistory(dirname(sessionFile), this.extractSessionId(sessionFile), metadata);
    this.loadIdeArtifacts(sessionDir, metadata);

    return {
      session_id: this.extractSessionId(sessionFile),
      messages,
      tool_calls: toolCalls,
      metadata,
      project_path: this.extractProjectPathFromMetadata(metadata)
    };
  }

  protected readFile(filePath: string): string { return readFileSync(filePath, "utf8"); }
  protected extractSessionId(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const parts = normalized.split("/");
    const file = parts[parts.length - 1] || "unknown";
    if (file === "messages.json" && parts.length > 1) {
      return (parts[parts.length - 2] || "unknown").replace(/^sess_/, "");
    }
    return file.replace(/\.(jsonl|json|history)$/i, "").replace(/^sess_/, "") || "unknown";
  }
  protected parseLines(content: string): string[] { return content.split(/\r?\n/); }
  protected parseLine(line: string): Record<string, any> | null {
    const trimmed = line.trim();
    return trimmed ? JSON.parse(trimmed) : null;
  }
  protected extractProjectPath(data: Record<string, any>): string | undefined {
    return data.cwd || data.projectPath || data.project_path || data.workspacePath || data.workspace;
  }
  protected processLine(data: Record<string, any>, lineNum: number, messages: Message[], toolCalls: ToolCall[], metadata: Record<string, any>): void {
    this.processRecord(data, lineNum, messages, toolCalls, metadata);
  }
  protected handleParseError(error: any, lineNum: number): void {
    logger.warn("kiro-extractor", `Skipping malformed Kiro record at line ${lineNum}`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  private resolveSessionFile(filePath: string): string {
    if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      const candidates = ["messages.json", "session.json", ...readdirSync(filePath).filter(file => file.endsWith(".jsonl"))];
      const found = candidates.map(file => join(filePath, file)).find(existsSync);
      if (found) return found;
    }
    throw new Error(`Kiro session file not found: ${filePath}`);
  }

  private resolveSessionDir(originalPath: string, sessionFile: string): string {
    if (basename(sessionFile) === "messages.json") return dirname(sessionFile);
    return existsSync(originalPath) && statSync(originalPath).isDirectory() ? originalPath : dirname(sessionFile);
  }

  private unwrapRecords(value: any): any[] {
    if (Array.isArray(value)) return value;
    for (const key of ["messages", "events", "records", "conversation", "items"]) {
      if (Array.isArray(value?.[key])) return value[key];
    }
    return value && typeof value === "object" ? [value] : [];
  }

  private processRecord(data: any, lineNum: number, messages: Message[], toolCalls: ToolCall[], metadata: Record<string, any>): void {
    if (!data || typeof data !== "object") return;
    const timestamp = data.timestamp || data.createdAt || data.created_at || data.time;
    const type = String(data.type || data.event || data.kind || "").toLowerCase();
    const payload = data.message || data.payload || data.data || data;
    const role = this.normalizeRole(payload.role || data.role || (type.includes("user") ? "user" : type.includes("assistant") || type.includes("ai") ? "assistant" : undefined));
    const content = this.extractTextContent(payload.content ?? payload.text ?? payload.output ?? (role ? payload : undefined));

    if (role && content) {
      messages.push({ role, content: this.sanitizeContent(content), timestamp, line_number: lineNum });
    }

    const toolName = payload.tool_name || payload.toolName || payload.name || payload.tool?.name;
    const isToolCall = type.includes("tool_call") || type.includes("tool-use") || type === "tool_use" || (toolName && !type.includes("result") && !type.includes("output"));
    if (isToolCall && toolName) {
      toolCalls.push({
        tool_name: String(toolName),
        input: this.toRecord(payload.input ?? payload.arguments ?? payload.args ?? payload.tool?.input ?? {}),
        timestamp,
        line_number: lineNum
      });
    }

    if (type.includes("tool_result") || type.includes("tool-result") || type.includes("tool_output") || type === "tool_result") {
      metadata.tool_results = metadata.tool_results || {};
      metadata.tool_results[data.call_id || data.callId || `line_${lineNum}`] = {
        content: payload.content ?? payload.output ?? data.result,
        timestamp,
        line_number: lineNum
      };
    }

    if (data.session_metadata || data.metadata) Object.assign(metadata, data.session_metadata || data.metadata);
    if (data.modelId || data.agentMode || data.autopilot !== undefined) {
      Object.assign(metadata, { model_id: data.modelId, agent_mode: data.agentMode, autopilot: data.autopilot });
    }
  }

  private normalizeRole(role: any): "user" | "assistant" | "system" | undefined {
    const value = String(role || "").toLowerCase();
    if (["user", "human", "prompt"].includes(value)) return "user";
    if (["assistant", "ai", "bot", "model"].includes(value)) return "assistant";
    if (["system", "developer"].includes(value)) return "system";
    return undefined;
  }

  private toRecord(value: any): Record<string, any> {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return { raw: value };
  }

  private mergeJsonMetadata(filePath: string, metadata: Record<string, any>): void {
    if (!existsSync(filePath)) return;
    try {
      const value = JSON.parse(readFileSync(filePath, "utf8"));
      if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(metadata, value);
    } catch (error) {
      logger.debug("kiro-extractor", `Unable to read metadata ${filePath}`, { error: String(error) });
    }
  }

  private loadHistory(directory: string, sessionId: string, metadata: Record<string, any>): void {
    const historyPath = join(directory, `${sessionId}.history`);
    if (!existsSync(historyPath)) return;
    try {
      metadata.command_history = readFileSync(historyPath, "utf8").split(/\r?\n/).filter(Boolean);
    } catch { /* optional artifact */ }
  }

  private loadIdeArtifacts(sessionDir: string, metadata: Record<string, any>): void {
    const cursorPath = join(sessionDir, "publish.cursor");
    if (existsSync(cursorPath)) metadata.publish_cursor = readFileSync(cursorPath, "utf8").trim();
    const snapshotsDir = join(sessionDir, "snapshots");
    if (existsSync(snapshotsDir) && statSync(snapshotsDir).isDirectory()) {
      metadata.snapshot_files = readdirSync(snapshotsDir);
    }
    const normalized = sessionDir.replace(/\\/g, "/").split("/");
    const workspaceIndex = normalized.indexOf("sessions");
    if (workspaceIndex >= 0 && normalized[workspaceIndex + 1]) metadata.workspace_hash = normalized[workspaceIndex + 1];
  }

  private extractProjectPathFromMetadata(metadata: Record<string, any>): string | undefined {
    return metadata.cwd || metadata.projectPath || metadata.project_path || metadata.workspacePath || metadata.workspace_root;
  }
}
