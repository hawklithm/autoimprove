/**
 * Session analyzer for AutoImprove.
 *
 * Analyzes Claude Code sessions and detects patterns.
 * Supports incremental analysis for performance.
 */

import { JSONLParser, SessionData, Message } from "./jsonl-parser.js";
import { Pattern, PatternType, PatternOccurrence, createPattern } from "./models.js";
import { ConfidenceCalculator } from "./confidence.js";
import { SessionCacheManager } from "../storage/session-cache.js";
import { statSync } from "fs";

export class SessionAnalyzer {
  private parser: JSONLParser;
  private confidenceCalc: ConfidenceCalculator;
  private cacheManager: SessionCacheManager;

  constructor() {
    this.parser = new JSONLParser();
    this.confidenceCalc = new ConfidenceCalculator();
    this.cacheManager = new SessionCacheManager();
  }

  /**
   * Analyze session file with incremental support
   * @param sessionFile Path to session JSONL file
   * @param options Analysis options
   */
  analyzeSession(
    sessionFile: string,
    options: { incremental?: boolean; forceReanalyze?: boolean } = {}
  ): Pattern[] {
    const { incremental = true, forceReanalyze = false } = options;

    // Parse session
    const sessionData = this.parser.parseFile(sessionFile);
    const sessionId = sessionData.session_id;

    // Check if we can use cached results
    if (incremental && !forceReanalyze) {
      const hasChanged = this.cacheManager.hasSessionChanged(sessionFile, sessionId);

      if (!hasChanged) {
        // No changes, return cached patterns
        const cached = this.cacheManager.getCached(sessionId);
        if (cached) {
          console.error(`Using cached analysis for session ${sessionId}`);
          return cached.cached_patterns;
        }
      }

      // Incremental analysis: only analyze new content
      if (this.cacheManager.hasAnalyzed(sessionId) && hasChanged) {
        return this.performIncrementalAnalysis(sessionFile, sessionData);
      }
    }

    // Full analysis
    return this.performFullAnalysis(sessionFile, sessionData);
  }

  /**
   * Perform full analysis on entire session
   */
  private performFullAnalysis(sessionFile: string, sessionData: SessionData): Pattern[] {
    console.error(`Performing full analysis for session ${sessionData.session_id}`);

    // Detect all pattern types
    const patterns: Pattern[] = [
      ...this.detectRepeatedCorrections(sessionData),
      ...this.detectAntiPatterns(sessionData),
      ...this.detectPreferences(sessionData),
      ...this.detectPerformancePatterns(sessionData),
      ...this.detectSecurityPatterns(sessionData)
    ];

    // Calculate confidence for all patterns
    for (const pattern of patterns) {
      pattern.confidence = this.confidenceCalc.calculateConfidence(pattern);
    }

    // Cache results
    const stats = statSync(sessionFile);
    const totalLines = sessionData.messages.length + sessionData.tool_calls.length;
    this.cacheManager.saveAnalysis(
      sessionData.session_id,
      sessionFile,
      totalLines,
      stats.size,
      patterns
    );

    return patterns;
  }

  /**
   * Perform incremental analysis on new content only
   */
  private performIncrementalAnalysis(sessionFile: string, sessionData: SessionData): Pattern[] {
    const sessionId = sessionData.session_id;
    const resumePoint = this.cacheManager.getResumePoint(sessionId);

    console.error(`Performing incremental analysis for session ${sessionId} from line ${resumePoint}`);

    // Filter to only new messages and tool calls
    const newMessages = sessionData.messages.filter(m => m.line_number > resumePoint);
    const newToolCalls = sessionData.tool_calls.filter(tc => tc.line_number > resumePoint);

    // Create partial session data
    const partialSessionData: SessionData = {
      ...sessionData,
      messages: newMessages,
      tool_calls: newToolCalls,
    };

    // Detect patterns in new content only
    const newPatterns: Pattern[] = [
      ...this.detectRepeatedCorrections(partialSessionData),
      ...this.detectAntiPatterns(partialSessionData),
      ...this.detectPreferences(partialSessionData),
      ...this.detectPerformancePatterns(partialSessionData),
      ...this.detectSecurityPatterns(partialSessionData)
    ];

    // Calculate confidence
    for (const pattern of newPatterns) {
      pattern.confidence = this.confidenceCalc.calculateConfidence(pattern);
    }

    // Merge with cached patterns
    const mergedPatterns = this.cacheManager.mergePatterns(sessionId, newPatterns);

    // Update cache
    const stats = statSync(sessionFile);
    const totalLines = sessionData.messages.length + sessionData.tool_calls.length;
    this.cacheManager.saveAnalysis(
      sessionId,
      sessionFile,
      totalLines,
      stats.size,
      mergedPatterns
    );

    return mergedPatterns;
  }

  /**
   * Clear cache for a specific session
   */
  clearCache(sessionId: string): void {
    this.cacheManager.clearSession(sessionId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cacheManager.getStats();
  }

  private detectRepeatedCorrections(sessionData: SessionData): Pattern[] {
    const patterns: Pattern[] = [];
    const userMessages = this.getUserMessages(sessionData);

    // Look for correction keywords
    const correctionKeywords = [
      "不对",
      "不是",
      "改成",
      "应该",
      "修正",
      "修改",
      "fix",
      "change",
      "should",
      "correct",
      "instead",
      "不要",
      "don't",
      "avoid",
      "别"
    ];

    const corrections = userMessages.filter(msg =>
      correctionKeywords.some(kw => msg.content.toLowerCase().includes(kw))
    );

    if (corrections.length > 0) {
      const pattern = createPattern({
        type: PatternType.REPEATED_CORRECTION,
        description: this.extractCorrectionDescription(corrections),
        occurrences: corrections.map(msg =>
          this.createOccurrence(sessionData, msg, "explicit_correction")
        ),
        first_seen: corrections[0].timestamp || new Date().toISOString(),
        last_seen: corrections[corrections.length - 1].timestamp || new Date().toISOString()
      });
      patterns.push(pattern);
    }

    return patterns;
  }

  private detectAntiPatterns(sessionData: SessionData): Pattern[] {
    const patterns: Pattern[] = [];
    const userMessages = this.getUserMessages(sessionData);

    const antiPatternKeywords = [
      "bug",
      "error",
      "wrong",
      "incorrect",
      "broken",
      "错误",
      "问题",
      "issue",
      "fail",
      "crash"
    ];

    for (const msg of userMessages) {
      if (antiPatternKeywords.some(kw => msg.content.toLowerCase().includes(kw))) {
        const description = this.extractAntiPatternDescription(msg);

        // Skip if description is empty (filtered as noise)
        if (!description || description.trim().length === 0) {
          continue;
        }

        const pattern = createPattern({
          type: PatternType.ANTI_PATTERN,
          description,
          occurrences: [this.createOccurrence(sessionData, msg, "explicit_correction")],
          first_seen: msg.timestamp || new Date().toISOString(),
          last_seen: msg.timestamp || new Date().toISOString()
        });
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectPreferences(sessionData: SessionData): Pattern[] {
    const patterns: Pattern[] = [];
    const userMessages = this.getUserMessages(sessionData);

    const preferenceKeywords = [
      "我们团队",
      "团队习惯",
      "我更喜欢",
      "我们约定",
      "we prefer",
      "our team",
      "we use",
      "convention",
      "约定",
      "规范"
    ];

    for (const msg of userMessages) {
      if (preferenceKeywords.some(kw => msg.content.toLowerCase().includes(kw))) {
        const description = this.extractPreferenceDescription(msg);

        // Skip if description is empty (filtered as noise)
        if (!description || description.trim().length === 0) {
          continue;
        }

        const pattern = createPattern({
          type: PatternType.PREFERENCE,
          description,
          occurrences: [this.createOccurrence(sessionData, msg, "accept")],
          first_seen: msg.timestamp || new Date().toISOString(),
          last_seen: msg.timestamp || new Date().toISOString()
        });
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectPerformancePatterns(sessionData: SessionData): Pattern[] {
    const patterns: Pattern[] = [];
    const userMessages = this.getUserMessages(sessionData);

    const performanceKeywords = [
      "useMemo",
      "useCallback",
      "React.memo",
      "重渲染",
      "性能",
      "optimize",
      "performance",
      "slow",
      "lag",
      "卡顿",
      "优化"
    ];

    for (const msg of userMessages) {
      if (performanceKeywords.some(kw => msg.content.toLowerCase().includes(kw))) {
        const description = this.extractPerformanceDescription(msg);

        // Skip if description is empty (filtered as noise)
        if (!description || description.trim().length === 0) {
          continue;
        }

        const pattern = createPattern({
          type: PatternType.PERFORMANCE,
          description,
          occurrences: [
            {
              ...this.createOccurrence(sessionData, msg, "explicit_correction"),
              performance_improved: true
            }
          ],
          first_seen: msg.timestamp || new Date().toISOString(),
          last_seen: msg.timestamp || new Date().toISOString()
        });
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private detectSecurityPatterns(sessionData: SessionData): Pattern[] {
    const patterns: Pattern[] = [];
    const userMessages = this.getUserMessages(sessionData);

    const securityKeywords = [
      "sql injection",
      "xss",
      "csrf",
      "injection",
      "注入",
      "安全",
      "security",
      "vulnerability",
      "sanitize",
      "escape",
      "validate"
    ];

    for (const msg of userMessages) {
      const matchedKeyword = securityKeywords.find(kw =>
        msg.content.toLowerCase().includes(kw)
      );
      if (matchedKeyword) {
        const description = this.extractSecurityDescription(msg);

        // Skip if description is empty (filtered as noise)
        if (!description || description.trim().length === 0) {
          continue;
        }

        const pattern = createPattern({
          type: PatternType.SECURITY,
          description,
          occurrences: [
            {
              ...this.createOccurrence(sessionData, msg, "explicit_correction"),
              security_issue: matchedKeyword
            }
          ],
          first_seen: msg.timestamp || new Date().toISOString(),
          last_seen: msg.timestamp || new Date().toISOString()
        });
        patterns.push(pattern);
      }
    }

    return patterns;
  }

  private getUserMessages(sessionData: SessionData): Message[] {
    return sessionData.messages.filter(msg => msg.role === "user");
  }

  private createOccurrence(
    sessionData: SessionData,
    msg: Message,
    action: PatternOccurrence["user_action"]
  ): PatternOccurrence {
    return {
      session_id: sessionData.session_id,
      timestamp: msg.timestamp || new Date().toISOString(),
      user_action: action,
      context: this.extractContext(sessionData, msg),
      user_input: msg.content.substring(0, 200)
    };
  }

  private extractContext(sessionData: SessionData, msg: Message): string {
    // Extract file paths from nearby tool calls
    const nearbyToolCalls = sessionData.tool_calls.filter(
      tc => Math.abs(tc.line_number - msg.line_number) < 10
    );

    const filePaths = nearbyToolCalls
      .map(tc => tc.input.file_path || tc.input.filePath)
      .filter(Boolean);

    return filePaths[0] || "unknown";
  }

  private extractCorrectionDescription(messages: Message[]): string {
    // Use first correction message as description
    const firstMsg = messages[0].content;
    return firstMsg.length > 100 ? firstMsg.substring(0, 100) + "..." : firstMsg;
  }

  private extractAntiPatternDescription(msg: Message): string {
    return this.extractMeaningfulDescription(msg, "anti-pattern");
  }

  private extractPreferenceDescription(msg: Message): string {
    return this.extractMeaningfulDescription(msg, "preference");
  }

  private extractPerformanceDescription(msg: Message): string {
    return this.extractMeaningfulDescription(msg, "performance");
  }

  private extractSecurityDescription(msg: Message): string {
    return this.extractMeaningfulDescription(msg, "security");
  }

  /**
   * Extract meaningful description from message, filtering out noise
   */
  private extractMeaningfulDescription(msg: Message, patternType: string): string {
    let content = msg.content.trim();

    // Skip if too short (likely not a real pattern)
    if (content.length < 15) {
      return "";
    }

    // Filter out noise patterns
    const noisePatterns = [
      // System/debug messages
      /(Base directory|Context Usage|Session analyzed|Model:|Tokens:)/i,
      // Generic questions without context
      /^(为什么|怎么|如何|what|why|how)\s*(还是不行|不work|doesn't work)/i,
      // Pure questions without actionable content
      /^\?+$|^[\?\？]+.*[\?\？]$/,
      // File paths and system info
      /^\/[\/\w\-\.]+$/,
      // Session IDs and UUIDs
      /^[a-f0-9-]{8,36}$/i,
      // Generic error messages without details
      /^(error|failed|不行|问题)$/i,
      // Continuation markers
      /^\.\.\./,
      // Pure metadata
      /^(AutoImprove|Consolidation|Analysis|Summary).*Results?$/i
    ];

    for (const pattern of noisePatterns) {
      if (pattern.test(content)) {
        return "";
      }
    }

    // Extract sentences that contain actionable information
    const sentences = content.split(/[。.!！\n]+/).filter(s => s.trim().length > 10);

    if (sentences.length === 0) {
      return "";
    }

    // For corrections/anti-patterns, look for sentences with corrective language
    if (patternType === "anti-pattern" || patternType === "performance" || patternType === "security") {
      const correctiveKeywords = [
        "应该", "不应该", "需要", "必须", "建议", "改成", "修改", "优化",
        "should", "shouldn't", "need to", "must", "recommend", "change to", "fix", "improve"
      ];

      const correctiveSentences = sentences.filter(s =>
        correctiveKeywords.some(kw => s.toLowerCase().includes(kw))
      );

      if (correctiveSentences.length > 0) {
        const description = correctiveSentences.join(". ").substring(0, 150);
        return description.length < correctiveSentences.join(". ").length
          ? description + "..."
          : description;
      }
    }

    // For preferences, look for declarative statements
    if (patternType === "preference") {
      const preferenceKeywords = [
        "我们用", "我们使用", "团队", "约定", "规范", "习惯",
        "we use", "our team", "convention", "practice", "prefer"
      ];

      const preferenceSentences = sentences.filter(s =>
        preferenceKeywords.some(kw => s.toLowerCase().includes(kw))
      );

      if (preferenceSentences.length > 0) {
        const description = preferenceSentences.join(". ").substring(0, 150);
        return description.length < preferenceSentences.join(". ").length
          ? description + "..."
          : description;
      }
    }

    // Fallback: use first meaningful sentence
    const firstSentence = sentences[0].trim();
    if (firstSentence.length > 15) {
      return firstSentence.length > 150
        ? firstSentence.substring(0, 150) + "..."
        : firstSentence;
    }

    return "";
  }
}
