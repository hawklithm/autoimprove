/**
 * Rule content manager for AutoImprove.
 *
 * Manages individual rule content files (rules/content/rule-{id}.md).
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { RuleContent } from "../core/models.js";

// Simple frontmatter parser/serializer
function parseFrontmatter(markdown: string): { metadata: Record<string, any>; content: string } {
  const lines = markdown.split("\n");

  if (lines[0] !== "---") {
    return { metadata: {}, content: markdown };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { metadata: {}, content: markdown };
  }

  // Parse YAML-like frontmatter
  const metadataLines = lines.slice(1, endIndex);
  const metadata: Record<string, any> = {};

  for (const line of metadataLines) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, key, value] = match;
      // Try to parse as JSON, fallback to string
      try {
        metadata[key] = JSON.parse(value);
      } catch {
        metadata[key] = value;
      }
    }
  }

  const content = lines.slice(endIndex + 1).join("\n").trim();

  return { metadata, content };
}

function serializeFrontmatter(metadata: Record<string, any>, content: string): string {
  const lines = ["---"];

  for (const [key, value] of Object.entries(metadata)) {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    lines.push(`${key}: ${serialized}`);
  }

  lines.push("---");
  lines.push("");
  lines.push(content);

  return lines.join("\n");
}

export class RuleContentManager {
  private getStorageRoot(): string {
    return process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
  }

  private getContentDir(): string {
    return join(this.getStorageRoot(), "rules", "content");
  }

  constructor() {
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    const contentDir = this.getContentDir();
    if (!existsSync(contentDir)) {
      mkdirSync(contentDir, { recursive: true });
    }
  }

  private getContentPath(ruleId: string): string {
    return join(this.getContentDir(), `${ruleId}.md`);
  }

  loadContent(ruleId: string): RuleContent | null {
    const path = this.getContentPath(ruleId);

    if (!existsSync(path)) {
      return null;
    }

    const markdown = readFileSync(path, "utf-8");
    const { metadata, content: body } = parseFrontmatter(markdown);

    // Extract content and reason from body
    let content = "";
    let reason = "";

    if (body.includes("## Content") && body.includes("## Reason")) {
      const parts = body.split("## Reason");
      content = parts[0].replace("## Content", "").trim();
      reason = parts[1].trim();
    } else {
      content = body;
    }

    return {
      id: ruleId,
      content,
      reason,
      metadata
    };
  }

  saveContent(rule: RuleContent): void {
    this.ensureDirectory();

    const path = this.getContentPath(rule.id);
    const body = `## Content\n\n${rule.content}\n\n## Reason\n\n${rule.reason}`;
    const markdown = serializeFrontmatter(rule.metadata, body);

    // Write to temp file first for atomic operation
    const tempPath = path + ".tmp";
    writeFileSync(tempPath, markdown);

    // Atomic rename
    renameSync(tempPath, path);
  }

  deleteContent(ruleId: string): boolean {
    const path = this.getContentPath(ruleId);

    if (!existsSync(path)) {
      return false;
    }

    unlinkSync(path);
    return true;
  }

  exists(ruleId: string): boolean {
    return existsSync(this.getContentPath(ruleId));
  }

  toMarkdown(rule: RuleContent): string {
    const body = `## Content\n\n${rule.content}\n\n## Reason\n\n${rule.reason}`;
    return serializeFrontmatter(rule.metadata, body);
  }
}
