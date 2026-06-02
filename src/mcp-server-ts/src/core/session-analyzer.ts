/**
 * Session analyzer for AutoImprove.
 *
 * Analyzes Claude Code sessions and detects patterns.
 */

import { JSONLParser, SessionData, Message } from "./jsonl-parser.js";
import { Pattern, PatternType, PatternOccurrence, createPattern } from "./models.js";
import { ConfidenceCalculator } from "./confidence.js";

export class SessionAnalyzer {
  private parser: JSONLParser;
  private confidenceCalc: ConfidenceCalculator;

  constructor() {
    this.parser = new JSONLParser();
    this.confidenceCalc = new ConfidenceCalculator();
  }

  analyzeSession(sessionFile: string): Pattern[] {
    // Parse session
    const sessionData = this.parser.parseFile(sessionFile);

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

    return patterns;
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
        const pattern = createPattern({
          type: PatternType.ANTI_PATTERN,
          description: this.extractAntiPatternDescription(msg),
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
        const pattern = createPattern({
          type: PatternType.PREFERENCE,
          description: this.extractPreferenceDescription(msg),
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
        const pattern = createPattern({
          type: PatternType.PERFORMANCE,
          description: this.extractPerformanceDescription(msg),
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
        const pattern = createPattern({
          type: PatternType.SECURITY,
          description: this.extractSecurityDescription(msg),
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
    return msg.content.length > 100 ? msg.content.substring(0, 100) + "..." : msg.content;
  }

  private extractPreferenceDescription(msg: Message): string {
    return msg.content.length > 100 ? msg.content.substring(0, 100) + "..." : msg.content;
  }

  private extractPerformanceDescription(msg: Message): string {
    return msg.content.length > 100 ? msg.content.substring(0, 100) + "..." : msg.content;
  }

  private extractSecurityDescription(msg: Message): string {
    return msg.content.length > 100 ? msg.content.substring(0, 100) + "..." : msg.content;
  }
}
