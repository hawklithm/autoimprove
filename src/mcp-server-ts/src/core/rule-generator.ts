/**
 * Rule generation from patterns.
 *
 * Converts validated patterns into structured rules.
 */

import { Pattern, RuleIndexEntry, RuleContent, Scene } from "./models.js";
import { RuleClassifier } from "./classifier.js";
import { ScopeDetector } from "./scope-detector.js";

export class RuleGenerator {
  private classifier: RuleClassifier;
  private scopeDetector: ScopeDetector;

  constructor() {
    this.classifier = new RuleClassifier();
    this.scopeDetector = new ScopeDetector();
  }

  generateRule(
    pattern: Pattern,
    ruleId: string,
    scene?: Scene,
    sessionContext?: {
      project_path?: string;
      organization_id?: string;
      project_id?: string;
    }
  ): { indexEntry: RuleIndexEntry; content: RuleContent } {
    // Determine priority
    const priority = this.classifier.determinePriority(pattern);

    // Detect scope
    const scopeResult = this.scopeDetector.detectScope(pattern, sessionContext);

    // Generate rule content
    const content = this.generateContent(pattern);
    const reason = this.generateReason(pattern);

    // Create timestamp
    const now = new Date().toISOString();

    // Create index entry
    const indexEntry: RuleIndexEntry = {
      id: ruleId,
      type: pattern.type,
      priority,
      confidence: pattern.confidence,
      scenes: scene || { tech: [], functional: [], business: [] },
      keywords: pattern.keywords,
      created_at: now,
      updated_at: now,
      scope: scopeResult.scope,
      scope_context: scopeResult.context
    };

    // Create content
    const ruleContent: RuleContent = {
      id: ruleId,
      content,
      reason,
      metadata: {
        type: pattern.type,
        priority,
        confidence: pattern.confidence,
        source: "learned",
        pattern_occurrences: pattern.occurrences.length,
        first_seen: pattern.first_seen,
        last_seen: pattern.last_seen,
        keywords: pattern.keywords,
        scope: scopeResult.scope,
        scope_confidence: scopeResult.confidence,
        scope_reason: scopeResult.reason
      }
    };

    return { indexEntry, content: ruleContent };
  }

  batchGenerateRules(
    patterns: Pattern[],
    startId: number,
    scene?: Scene,
    sessionContext?: {
      project_path?: string;
      organization_id?: string;
      project_id?: string;
    }
  ): Array<{ indexEntry: RuleIndexEntry; content: RuleContent }> {
    const rules: Array<{ indexEntry: RuleIndexEntry; content: RuleContent }> = [];

    for (let i = 0; i < patterns.length; i++) {
      const pattern = patterns[i];
      const ruleId = `rule-${String(startId + i).padStart(3, "0")}`;

      // Check if should generate rule
      const { shouldGenerate } = this.classifier.shouldGenerateRule(pattern);
      if (!shouldGenerate) {
        continue;
      }

      const rule = this.generateRule(pattern, ruleId, scene, sessionContext);
      rules.push(rule);
    }

    return rules;
  }

  private generateContent(pattern: Pattern): string {
    // Extract generic pattern from user feedback
    let content = this.extractGenericPattern(pattern);

    // Add context if available from occurrences
    const contexts = new Set<string>();
    for (const occurrence of pattern.occurrences) {
      if (occurrence.context && occurrence.context.includes("/")) {
        const parts = occurrence.context.split("/");
        if (parts.length > 1) {
          contexts.add(parts[parts.length - 1]);
        }
      }
    }

    if (contexts.size > 0) {
      const contextStr = Array.from(contexts)
        .slice(0, 3)
        .sort()
        .join(", ");
      content += `\n\n**Applies to**: ${contextStr}`;
    }

    // Add original example as context (truncated)
    if (pattern.description.length > 100) {
      const truncated = pattern.description.substring(0, 150) + "...";
      content += `\n\n**Example context**: ${truncated}`;
    }

    return content;
  }

  /**
   * Extract generic, reusable pattern from user feedback
   */
  private extractGenericPattern(pattern: Pattern): string {
    const desc = pattern.description;

    // Pattern detection based on keywords and structure

    // API abstraction pattern
    if (this.matchesApiAbstractionPattern(desc)) {
      return this.generateApiAbstractionRule(desc);
    }

    // State machine/workflow pattern
    if (this.matchesWorkflowPattern(desc)) {
      return this.generateWorkflowRule(desc);
    }

    // Code quality/refactoring pattern
    if (this.matchesRefactoringPattern(desc)) {
      return this.generateRefactoringRule(desc);
    }

    // Configuration/setup pattern
    if (this.matchesConfigPattern(desc)) {
      return this.generateConfigRule(desc);
    }

    // Error handling pattern
    if (this.matchesErrorHandlingPattern(desc)) {
      return this.generateErrorHandlingRule(desc);
    }

    // Default: extract key action verbs and objects
    return this.generateGenericRule(desc, pattern.type);
  }

  private matchesApiAbstractionPattern(desc: string): boolean {
    const keywords = ['替换', 'replace', '隐藏', 'hide', 'expose', '暴露', 'wrapper', '封装'];
    const hasKeyword = keywords.some(kw => desc.toLowerCase().includes(kw));
    const hasComparison = desc.includes('比较') || desc.includes('compare');
    return hasKeyword && (hasComparison || desc.includes('调用'));
  }

  private generateApiAbstractionRule(desc: string): string {
    return `**API Abstraction and Encapsulation**

When a higher-level function wraps a lower-level function:
1. Replace all external call sites to use the higher-level wrapper
2. Hide the lower-level function from the public API (make it internal-only)
3. This prevents API confusion and enforces best practices

**Benefits**:
- Single public entry point reduces maintenance burden
- Prevents users from bypassing optimizations in the wrapper
- Clearer API surface with proper abstraction layers`;
  }

  private matchesWorkflowPattern(desc: string): boolean {
    const keywords = ['状态', 'state', 'workflow', '流程', 'transition', '转移', 'status'];
    return keywords.some(kw => desc.toLowerCase().includes(kw));
  }

  private generateWorkflowRule(desc: string): string {
    return `**State Machine and Workflow Management**

Maintain strict workflow transitions:
1. Validate state transitions against defined rules
2. Prevent direct status updates that bypass validation
3. Implement automatic lock release mechanisms to avoid deadlocks

**Key principles**:
- State transitions should be explicit and validated
- Each state change should trigger appropriate side effects
- Locks should have timeout and recovery mechanisms`;
  }

  private matchesRefactoringPattern(desc: string): boolean {
    const keywords = ['优化', 'optimize', 'refactor', '重构', '拆分', 'split', '模块化', 'modular'];
    return keywords.some(kw => desc.toLowerCase().includes(kw));
  }

  private generateRefactoringRule(desc: string): string {
    if (desc.includes('拆分') || desc.includes('split') || desc.includes('模块')) {
      return `**Code Modularization**

When code grows complex, split by functional boundaries:
1. Identify distinct functional responsibilities
2. Extract to separate modules/packages
3. Define clear interfaces between modules
4. Maintain backward compatibility during transition

**Benefits**:
- Improved maintainability and testability
- Clear separation of concerns
- Easier to understand and modify`;
    }

    return `**Code Optimization**

Identify and eliminate performance bottlenecks:
1. Profile to find actual bottlenecks (don't guess)
2. Optimize the critical path first
3. Measure before and after to validate improvement

**Anti-pattern**: Premature optimization without measurement`;
  }

  private matchesConfigPattern(desc: string): boolean {
    const keywords = ['setup', '安装', 'config', '配置', 'claude.md', 'script', '脚本'];
    return keywords.some(kw => desc.toLowerCase().includes(kw));
  }

  private generateConfigRule(desc: string): string {
    if (desc.toLowerCase().includes('setup') || desc.includes('脚本')) {
      return `**Configuration Management in Setup Scripts**

When modifying Claude configuration files (CLAUDE.md, settings, etc.):
1. Add the modification logic to setup scripts (e.g., setup.sh)
2. Make setup scripts idempotent (safe to run multiple times)
3. Check if content already exists before adding

**Why**: Ensures consistent setup across environments and avoids duplicate entries`;
    }

    return `**Project Configuration**

Document configuration changes in project setup:
1. Update CLAUDE.md with new tool usage patterns
2. Include example commands and workflows
3. Explain when and why to use specific tools`;
  }

  private matchesErrorHandlingPattern(desc: string): boolean {
    const keywords = ['error', '错误', 'exception', '异常', 'fix', '修复', 'bug'];
    return keywords.some(kw => desc.toLowerCase().includes(kw));
  }

  private generateErrorHandlingRule(desc: string): string {
    return `**Error Handling and Debugging**

When encountering errors:
1. Analyze the error message and stack trace first
2. Identify the root cause before attempting fixes
3. Fix the underlying issue, not just the symptom

**Anti-pattern**: Making quick fixes without understanding the root cause`;
  }

  private generateGenericRule(desc: string, patternType: string): string {
    // Extract key verbs and objects using simple heuristics
    const sentences = desc.split(/[。，,;；]/);
    const firstSentence = sentences[0].substring(0, 200);

    // Try to identify the core action
    const actionVerbs = this.extractActionVerbs(firstSentence);

    if (actionVerbs.length > 0) {
      const action = actionVerbs[0];
      return `**${this.capitalizeFirst(patternType)} Pattern**

Core principle: ${action}

Based on user feedback, this pattern emphasizes the importance of ${action.toLowerCase()}.

**Context**: This rule was learned from repeated corrections in similar scenarios.`;
    }

    // Fallback: use truncated description with disclaimer
    return `**${this.capitalizeFirst(patternType)} Pattern**

${firstSentence.substring(0, 150)}${firstSentence.length > 150 ? '...' : ''}

**Note**: This rule requires further refinement to extract a more generic pattern.`;
  }

  private extractActionVerbs(text: string): string[] {
    const verbs: string[] = [];

    // Common action patterns
    const patterns = [
      /应该([一-龥]+)/g, // Chinese: should do X
      /需要([一-龥]+)/g, // Chinese: need to do X
      /must ([\w\s]+)/gi,
      /should ([\w\s]+)/gi,
      /always ([\w\s]+)/gi,
      /never ([\w\s]+)/gi,
    ];

    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          verbs.push(match[1].trim().split(/[\s,，]/)[0]);
        }
      }
    }

    return verbs;
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private generateReason(pattern: Pattern): string {
    const reasons: string[] = [];

    // Count occurrences
    const occurrenceCount = pattern.occurrences.length;
    const uniqueSessions = new Set(pattern.occurrences.map(o => o.session_id)).size;

    if (uniqueSessions > 1) {
      reasons.push(`Corrected ${occurrenceCount} times across ${uniqueSessions} sessions`);
    } else {
      reasons.push(`Corrected ${occurrenceCount} times in one session`);
    }

    // Add validation evidence
    const testPassed = pattern.occurrences.filter(o => o.test_passed === true).length;
    if (testPassed > 0) {
      reasons.push(`validated by ${testPassed} test(s)`);
    }

    const perfImproved = pattern.occurrences.filter(o => o.performance_improved === true)
      .length;
    if (perfImproved > 0) {
      reasons.push("improved performance");
    }

    const securityIssues = pattern.occurrences.filter(o => o.security_issue).length;
    if (securityIssues > 0) {
      reasons.push(`fixed ${securityIssues} security issue(s)`);
    }

    // Add user preference indication
    if (pattern.keywords.length > 0) {
      const keywordStr = pattern.keywords.slice(0, 3).join(", ");
      reasons.push(`keywords: ${keywordStr}`);
    }

    return reasons.join("; ");
  }
}
