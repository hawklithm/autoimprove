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
import { CompactCacheManager } from "../storage/compact-cache.js";
import { statSync } from "fs";

export class SessionAnalyzer {
  private parser: JSONLParser;
  private confidenceCalc: ConfidenceCalculator;
  private cacheManager: SessionCacheManager;
  private compactCache: CompactCacheManager;

  constructor() {
    this.parser = new JSONLParser();
    this.confidenceCalc = new ConfidenceCalculator();
    this.cacheManager = new SessionCacheManager();
    this.compactCache = new CompactCacheManager();
  }

  /**
   * Analyze session file with incremental support and compact cache
   * @param sessionFile Path to session JSONL file
   * @param options Analysis options
   */
  analyzeSession(
    sessionFile: string,
    options: { incremental?: boolean; forceReanalyze?: boolean; useCompactCache?: boolean } = {}
  ): Pattern[] {
    const { incremental = true, forceReanalyze = false, useCompactCache = true } = options;

    // Load session data (with compact cache optimization)
    const sessionData = this.loadSessionData(sessionFile, useCompactCache);
    const sessionId = sessionData.session_id;

    // Check if we can use cached results
    if (incremental && !forceReanalyze) {
      const hasChanged = this.cacheManager.hasSessionChanged(sessionFile, sessionId);

      if (!hasChanged) {
        // No changes, return cached patterns
        const cached = this.cacheManager.getCached(sessionId);
        if (cached) {
          // console.error(`Using cached analysis for session ${sessionId}`);
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
    // console.error(`Performing full analysis for session ${sessionData.session_id}`);

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

    // console.error(`Performing incremental analysis for session ${sessionId} from line ${resumePoint}`);

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
   * Clear compact cache for a specific session or all sessions
   */
  clearCompactCache(sessionId?: string): { cleared: number; errors: string[] } {
    return this.compactCache.clearCache(sessionId);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cacheManager.getStats();
  }

  /**
   * Get compact cache statistics
   */
  getCompactCacheStats() {
    return this.compactCache.getMetrics();
  }

  /**
   * Load session data with compact cache optimization
   */
  private loadSessionData(sessionFile: string, useCompactCache: boolean): SessionData {
    if (!useCompactCache) {
      // Direct parsing without cache
      return this.parser.parseFile(sessionFile);
    }

    const originalSize = statSync(sessionFile).size;

    // Check if compact cache exists and is valid
    if (!this.compactCache.needsRegeneration(sessionFile)) {
      // Load from compact cache
      const compactCache = this.compactCache.loadCache(sessionFile);
      if (compactCache) {
        const cacheSize = JSON.stringify(compactCache).length;
        const timeSaved = this.estimateTimeSaved(originalSize);
        const bytesSaved = originalSize - cacheSize;

        this.compactCache.recordCacheHit(timeSaved, bytesSaved);

        // Removed console logging for MCP server compatibility
        // Previously logged: Using compact cache for ${session_id} (saved ${time}ms, ${bytes})

        return this.compactCache.toSessionData(compactCache);
      }
    }

    // Cache miss or needs regeneration
    this.compactCache.recordCacheMiss();

    // Parse the original file
    const sessionData = this.parser.parseFile(sessionFile);

    // Generate compact cache for next time
    this.compactCache.generateCache(sessionFile, sessionData);

    return sessionData;
  }

  /**
   * Estimate time saved by using compact cache
   */
  private estimateTimeSaved(originalSize: number): number {
    // Empirical formula: ~0.3ms per KB of original file size
    // Average savings: 50-75% of parsing time
    const baseTime = (originalSize / 1024) * 0.3;
    return Math.floor(baseTime * 0.65);
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

    // More specific security keywords that require technical context
    const specificSecurityKeywords = [
      "sql injection",
      "xss",
      "csrf",
      "injection attack",
      "code injection",
      "command injection",
      "sanitize input",
      "escape output",
      "vulnerability",
      "exploit"
    ];

    // Generic security terms that need additional validation
    const genericSecurityKeywords = [
      "injection",
      "注入",
      "安全漏洞",
      "security issue",
      "sanitize",
      "escape",
      "validate input"
    ];

    for (const msg of userMessages) {
      const content = msg.content.toLowerCase();

      // Check for specific security keywords (high confidence)
      const hasSpecificKeyword = specificSecurityKeywords.some(kw => content.includes(kw));

      // Check for generic security keywords (need additional validation)
      const hasGenericKeyword = genericSecurityKeywords.some(kw => content.includes(kw));

      // For generic keywords, require additional evidence:
      // 1. Must contain technical details (code, functions, file paths)
      // 2. Must contain corrective language (not just questions)
      if (hasGenericKeyword && !hasSpecificKeyword) {
        const hasTechnical = this.hasSecurityTechnicalContext(msg.content);
        const hasCorrective = this.hasCorrectiveLanguage(msg.content);

        if (!hasTechnical || !hasCorrective) {
          continue;  // Skip generic security mentions without context
        }
      }

      // If we have specific keyword or validated generic keyword
      if (hasSpecificKeyword || hasGenericKeyword) {
        const matchedKeyword = specificSecurityKeywords.find(kw => content.includes(kw)) ||
                               genericSecurityKeywords.find(kw => content.includes(kw)) ||
                               "security";

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

  /**
   * Check if content has security-related technical context
   */
  private hasSecurityTechnicalContext(content: string): boolean {
    const securityTechnicalPatterns = [
      // Input validation patterns
      /(validate|sanitize|escape|filter)\s+(\w+|input|output|data|parameter)/i,
      // SQL-related
      /(prepared statement|parameterized query|sql parameter|query builder)/i,
      // XSS-related
      /(innerHTML|dangerouslySetInnerHTML|DOM manipulation|script tag)/i,
      // Authentication/Authorization
      /(jwt|token|session|auth|permission|role|access control)/i,
      // Encryption
      /(encrypt|decrypt|hash|bcrypt|crypto|salt)/i,
      // Code patterns indicating security fixes
      /\w+\.(escape|sanitize|validate|filter)\(/i,
      /(if|check|verify)\s+.*\s+(auth|permission|valid|safe)/i,
    ];

    return securityTechnicalPatterns.some(pattern => pattern.test(content));
  }

  /**
   * Check if content contains corrective language (indicating a fix, not a question)
   */
  private hasCorrectiveLanguage(content: string): boolean {
    const correctivePatterns = [
      /(需要|应该|必须|改成|修改|添加|使用)/,  // Chinese
      /(need to|should|must|change to|modify|add|use|fix|prevent)/i,  // English
      /(不要|别用|避免)/,  // Chinese "don't"
      /(don't|avoid|never|remove)/i,  // English "don't"
    ];

    return correctivePatterns.some(pattern => pattern.test(content));
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

    // Skip if too short (likely not a real pattern) - increased threshold
    if (content.length < 30) {
      return "";
    }

    // Filter out request phrases (questions/requests, not corrections)
    const requestPatterns = [
      /^(请|能不能|帮我|可以吗|麻烦|帮忙)/i,
      /^(can you|could you|please|help me|would you)/i,
      /^(how do|how to|how can|what should|should i)/i,
      /^(给我|看看|检查|分析一下)/i,
      /(能不能|可以吗|好吗|行吗)\s*[?？]?\s*$/i
    ];

    for (const pattern of requestPatterns) {
      if (pattern.test(content)) {
        return "";
      }
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

    // Check if content contains technical details (code, function names, file paths)
    const hasTechnicalDetail = this.hasTechnicalDetail(content);
    if (!hasTechnicalDetail && patternType !== "preference") {
      // For non-preference patterns, require technical details
      return "";
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

  /**
   * Check if content contains technical details (code, function names, file paths, technical terms)
   */
  private hasTechnicalDetail(content: string): boolean {
    const technicalIndicators = [
      // Code patterns
      /[\w]+\(.*\)/,  // Function calls: foo()
      /[\w]+\.\w+/,    // Property access: obj.prop
      /[\w]+::\w+/,    // Static access: Class::method
      /`[^`]+`/,       // Inline code
      /```/,           // Code blocks

      // File patterns
      /\w+\.(ts|js|tsx|jsx|py|java|go|rs|c|cpp|h|css|html|json|yaml|yml|md|sql)/i,
      /src\/|lib\/|dist\/|node_modules\//i,

      // Technical terms (specific enough)
      /(function|method|class|interface|type|const|let|var|import|export|async|await)/i,
      /(useState|useEffect|useCallback|useMemo|useRef)/i,  // React hooks
      /(query|mutation|resolver|schema)/i,  // GraphQL/DB
      /(endpoint|route|handler|middleware)/i,  // Backend

      // Variable/function naming patterns
      /\w+_\w+/,  // snake_case
      /[a-z]+[A-Z]\w*/,  // camelCase
    ];

    return technicalIndicators.some(pattern => pattern.test(content));
  }
}
