/**
 * Rule version control for AutoImprove.
 *
 * Provides versioning, history tracking, and rollback capabilities for rules.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { RuleContent } from "../core/models.js";

export interface RuleVersion {
  id: string;
  version: number;
  content: RuleContent;
  created_at: string;
  created_by: "user" | "auto";
  parent_version?: number;
  change_summary?: string;
}

export interface RuleVersionMetadata {
  rule_id: string;
  current_version: number;
  total_versions: number;
  created_at: string;
  last_updated: string;
}

export class RuleVersionControl {
  private getStorageRoot(): string {
    return process.env.AUTOIMPROVE_STORAGE_ROOT || join(homedir(), ".autoimprove");
  }

  private getVersionsDir(): string {
    return join(this.getStorageRoot(), "versions");
  }

  private getRuleVersionDir(ruleId: string): string {
    return join(this.getVersionsDir(), ruleId);
  }

  private getVersionFilePath(ruleId: string, version: number): string {
    return join(this.getRuleVersionDir(ruleId), `v${version}.json`);
  }

  private getMetadataPath(ruleId: string): string {
    return join(this.getRuleVersionDir(ruleId), "metadata.json");
  }

  constructor() {
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    const versionsDir = this.getVersionsDir();
    if (!existsSync(versionsDir)) {
      mkdirSync(versionsDir, { recursive: true });
    }
  }

  private ensureRuleDirectory(ruleId: string): void {
    const ruleDir = this.getRuleVersionDir(ruleId);
    if (!existsSync(ruleDir)) {
      mkdirSync(ruleDir, { recursive: true });
    }
  }

  /**
   * Save a new version of a rule
   */
  saveVersion(
    rule: RuleContent,
    createdBy: "user" | "auto" = "auto",
    changeSummary?: string
  ): RuleVersion {
    this.ensureRuleDirectory(rule.id);

    // Load or create metadata
    let metadata = this.loadMetadata(rule.id);
    const isNewRule = !metadata;

    if (!metadata) {
      metadata = {
        rule_id: rule.id,
        current_version: 0,
        total_versions: 0,
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };
    }

    // Increment version
    const newVersion = metadata.current_version + 1;
    const parentVersion = metadata.current_version > 0 ? metadata.current_version : undefined;

    // Create version entry
    const version: RuleVersion = {
      id: rule.id,
      version: newVersion,
      content: rule,
      created_at: new Date().toISOString(),
      created_by: createdBy,
      parent_version: parentVersion,
      change_summary: changeSummary || (isNewRule ? "Initial version" : "Updated rule"),
    };

    // Save version file
    const versionPath = this.getVersionFilePath(rule.id, newVersion);
    writeFileSync(versionPath, JSON.stringify(version, null, 2));

    // Update metadata
    metadata.current_version = newVersion;
    metadata.total_versions = newVersion;
    metadata.last_updated = new Date().toISOString();
    this.saveMetadata(metadata);

    return version;
  }

  /**
   * Get a specific version of a rule
   */
  getVersion(ruleId: string, version: number): RuleVersion | null {
    const versionPath = this.getVersionFilePath(ruleId, version);
    if (!existsSync(versionPath)) {
      return null;
    }

    const data = readFileSync(versionPath, "utf-8");
    return JSON.parse(data) as RuleVersion;
  }

  /**
   * Get the current (latest) version of a rule
   */
  getCurrentVersion(ruleId: string): RuleVersion | null {
    const metadata = this.loadMetadata(ruleId);
    if (!metadata) {
      return null;
    }

    return this.getVersion(ruleId, metadata.current_version);
  }

  /**
   * Get all versions of a rule
   */
  getVersionHistory(ruleId: string): RuleVersion[] {
    const metadata = this.loadMetadata(ruleId);
    if (!metadata) {
      return [];
    }

    const versions: RuleVersion[] = [];
    for (let v = 1; v <= metadata.total_versions; v++) {
      const version = this.getVersion(ruleId, v);
      if (version) {
        versions.push(version);
      }
    }

    return versions;
  }

  /**
   * Rollback to a previous version
   */
  rollback(ruleId: string, toVersion: number): RuleVersion | null {
    const targetVersion = this.getVersion(ruleId, toVersion);
    if (!targetVersion) {
      throw new Error(`Version ${toVersion} not found for rule ${ruleId}`);
    }

    // Create a new version based on the target version
    const newVersion = this.saveVersion(
      targetVersion.content,
      "user",
      `Rolled back to version ${toVersion}`
    );

    return newVersion;
  }

  /**
   * Compare two versions
   */
  compareVersions(ruleId: string, version1: number, version2: number): {
    version1: RuleVersion | null;
    version2: RuleVersion | null;
    contentChanged: boolean;
    reasonChanged: boolean;
    confidenceChanged: boolean;
    changes: string[];
  } {
    const v1 = this.getVersion(ruleId, version1);
    const v2 = this.getVersion(ruleId, version2);

    const changes: string[] = [];

    if (!v1 || !v2) {
      return {
        version1: v1,
        version2: v2,
        contentChanged: false,
        reasonChanged: false,
        confidenceChanged: false,
        changes: ["One or both versions not found"],
      };
    }

    const contentChanged = v1.content.content !== v2.content.content;
    const reasonChanged = v1.content.reason !== v2.content.reason;
    const confidenceChanged =
      v1.content.metadata.confidence !== v2.content.metadata.confidence;

    if (contentChanged) {
      changes.push("Content changed");
    }
    if (reasonChanged) {
      changes.push("Reason changed");
    }
    if (confidenceChanged) {
      changes.push(
        `Confidence: ${v1.content.metadata.confidence.toFixed(2)} → ${v2.content.metadata.confidence.toFixed(2)}`
      );
    }

    return {
      version1: v1,
      version2: v2,
      contentChanged,
      reasonChanged,
      confidenceChanged,
      changes,
    };
  }

  /**
   * Get metadata for a rule
   */
  loadMetadata(ruleId: string): RuleVersionMetadata | null {
    const metadataPath = this.getMetadataPath(ruleId);
    if (!existsSync(metadataPath)) {
      return null;
    }

    const data = readFileSync(metadataPath, "utf-8");
    return JSON.parse(data) as RuleVersionMetadata;
  }

  /**
   * Save metadata for a rule
   */
  private saveMetadata(metadata: RuleVersionMetadata): void {
    this.ensureRuleDirectory(metadata.rule_id);
    const metadataPath = this.getMetadataPath(metadata.rule_id);
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Get all rules with version info
   */
  listAllRuleVersions(): RuleVersionMetadata[] {
    const versionsDir = this.getVersionsDir();
    if (!existsSync(versionsDir)) {
      return [];
    }

    const ruleIds = readdirSync(versionsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    const metadatas: RuleVersionMetadata[] = [];
    for (const ruleId of ruleIds) {
      const metadata = this.loadMetadata(ruleId);
      if (metadata) {
        metadatas.push(metadata);
      }
    }

    return metadatas;
  }

  /**
   * Delete all versions of a rule
   */
  deleteRule(ruleId: string): void {
    const ruleDir = this.getRuleVersionDir(ruleId);
    if (existsSync(ruleDir)) {
      // Delete all version files
      const files = readdirSync(ruleDir);
      for (const file of files) {
        const filePath = join(ruleDir, file);
        // Simple sync delete (in production, use proper recursive delete)
        try {
          const fs = require("fs");
          fs.unlinkSync(filePath);
        } catch (err) {
          // console.error(`Failed to delete ${filePath}:`, err);
        }
      }

      // Delete directory
      try {
        const fs = require("fs");
        fs.rmdirSync(ruleDir);
      } catch (err) {
        // console.error(`Failed to delete directory ${ruleDir}:`, err);
      }
    }
  }

  /**
   * Get version statistics
   */
  getStats(): {
    total_rules: number;
    total_versions: number;
    avg_versions_per_rule: number;
    rules_with_rollbacks: number;
  } {
    const metadatas = this.listAllRuleVersions();
    const totalRules = metadatas.length;
    const totalVersions = metadatas.reduce((sum, m) => sum + m.total_versions, 0);

    // Count rules with rollbacks (version > 1 with parent version < current - 1)
    let rulesWithRollbacks = 0;
    for (const metadata of metadatas) {
      const versions = this.getVersionHistory(metadata.rule_id);
      for (const v of versions) {
        if (v.parent_version && v.parent_version < v.version - 1) {
          rulesWithRollbacks++;
          break;
        }
      }
    }

    return {
      total_rules: totalRules,
      total_versions: totalVersions,
      avg_versions_per_rule: totalRules > 0 ? totalVersions / totalRules : 0,
      rules_with_rollbacks: rulesWithRollbacks,
    };
  }
}
