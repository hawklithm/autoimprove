/**
 * Session archive manager for AutoImprove.
 *
 * Manages session archive files (sessions/{session_id}.json).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { SessionArchive } from "../core/models.js";

export class SessionArchiveManager {
  private getStorageRoot(): string {
    return process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
  }

  private getSessionsDir(): string {
    return join(this.getStorageRoot(), "sessions");
  }

  constructor() {
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    const sessionsDir = this.getSessionsDir();
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }
  }

  private getArchivePath(sessionId: string): string {
    return join(this.getSessionsDir(), `${sessionId}.json`);
  }

  saveArchive(archive: SessionArchive): void {
    this.ensureDirectory();

    const path = this.getArchivePath(archive.session_id);

    // Write to temp file first for atomic operation
    const tempPath = path + ".tmp";
    writeFileSync(tempPath, JSON.stringify(archive, null, 2));

    // Atomic rename
    const fs = require("fs");
    fs.renameSync(tempPath, path);
  }

  loadArchive(sessionId: string): SessionArchive | null {
    const path = this.getArchivePath(sessionId);

    if (!existsSync(path)) {
      return null;
    }

    const data = readFileSync(path, "utf-8");
    return JSON.parse(data) as SessionArchive;
  }

  listArchives(): SessionArchive[] {
    const sessionsDir = this.getSessionsDir();
    if (!existsSync(sessionsDir)) {
      return [];
    }

    const files = readdirSync(sessionsDir);
    const archives: SessionArchive[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        const sessionId = file.replace(".json", "");
        const archive = this.loadArchive(sessionId);
        if (archive) {
          archives.push(archive);
        }
      }
    }

    // Sort by created_at descending
    archives.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return archives;
  }

  exists(sessionId: string): boolean {
    return existsSync(this.getArchivePath(sessionId));
  }
}
