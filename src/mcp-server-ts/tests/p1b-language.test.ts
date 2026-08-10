import { describe, it, expect, afterEach } from "vitest";
import { LLMPromptBuilder } from "../src/core/llm-prompt-builder.js";
import { LLMConfigManager } from "../src/core/llm-config-manager.js";
import { PromptEvidence, PromptOptions } from "../src/core/llm-prompt-builder.js";

function ev(
  description: string,
  keywords: string[] = [],
  contentExamples: string[] = [],
  userContext: string[] = []
): PromptEvidence {
  return { description, confidence: 0.8, occurrences: 2, keywords, contentExamples, userContext };
}

function opts(over: Partial<PromptOptions> = {}): PromptOptions {
  return {
    patternType: "preference",
    avgConfidence: 0.8,
    commonKeywords: [],
    totalOccurrences: 2,
    sessionCount: 1,
    isBatchMode: true,
    maxContentExamples: 5,
    ...over,
  };
}

describe("P1-B — 缺陷 B 修复：规则语言对齐（中文会话→中文规则）", () => {
  describe("detectLanguage", () => {
    it("中文为主 → zh", () => {
      expect(LLMPromptBuilder.detectLanguage("请使用绝对路径而非相对路径来调用工具")).toBe("zh");
    });
    it("纯英文 → en", () => {
      expect(LLMPromptBuilder.detectLanguage("Always use absolute paths instead of relative paths")).toBe("en");
    });
    it("英文为主、仅关键词含少量中文 → en（不被个别中文 token 带偏）", () => {
      const text = "Use absolute paths for tool calls; 路径 must be absolute when possible in scripts";
      expect(LLMPromptBuilder.detectLanguage(text)).toBe("en");
    });
    it("空串 → en", () => {
      expect(LLMPromptBuilder.detectLanguage("")).toBe("en");
    });
  });

  describe("buildPrompt 语言指令注入", () => {
    it("auto + 中文证据 → 注入简体中文指令", () => {
      const prompt = LLMPromptBuilder.buildPrompt(
        [ev("用户要求始终使用绝对路径而非相对路径", ["绝对路径", "relative"], ["请用绝对路径"])],
        opts({ outputLanguage: "auto" })
      );
      expect(prompt).toContain("输出语言");
      expect(prompt).toContain("简体中文");
    });

    it("auto + 英文证据 → 不注入中文指令（保持英文旧行为）", () => {
      const prompt = LLMPromptBuilder.buildPrompt(
        [ev("User asked to always use absolute paths instead of relative paths", ["absolute", "paths"])],
        opts({ outputLanguage: "auto" })
      );
      expect(prompt).not.toContain("简体中文");
    });

    it("显式 en + 中文证据 → 不注入中文指令", () => {
      const prompt = LLMPromptBuilder.buildPrompt(
        [ev("用户要求始终使用绝对路径", ["绝对路径"])],
        opts({ outputLanguage: "en" })
      );
      expect(prompt).not.toContain("简体中文");
    });

    it("显式 zh + 英文证据 → 注入简体中文指令", () => {
      const prompt = LLMPromptBuilder.buildPrompt(
        [ev("User asked to always use absolute paths", ["absolute"])],
        opts({ outputLanguage: "zh" })
      );
      expect(prompt).toContain("简体中文");
    });
  });

  describe("LLMConfigManager.defaultRuleLanguage", () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env.AUTOIMPROVE_RULE_LANGUAGE = saved.AUTOIMPROVE_RULE_LANGUAGE;
      process.env.LLM_RULE_LANGUAGE = saved.LLM_RULE_LANGUAGE;
    });

    it("默认 auto", () => {
      delete process.env.AUTOIMPROVE_RULE_LANGUAGE;
      delete process.env.LLM_RULE_LANGUAGE;
      expect(new LLMConfigManager().getDefaultRuleLanguage()).toBe("auto");
    });

    it("AUTOIMPROVE_RULE_LANGUAGE=zh → zh", () => {
      process.env.AUTOIMPROVE_RULE_LANGUAGE = "zh";
      delete process.env.LLM_RULE_LANGUAGE;
      expect(new LLMConfigManager().getDefaultRuleLanguage()).toBe("zh");
    });

    it("LLM_RULE_LANGUAGE=en → en", () => {
      delete process.env.AUTOIMPROVE_RULE_LANGUAGE;
      process.env.LLM_RULE_LANGUAGE = "en";
      expect(new LLMConfigManager().getDefaultRuleLanguage()).toBe("en");
    });

    it("非法值 → auto", () => {
      process.env.AUTOIMPROVE_RULE_LANGUAGE = "klingon";
      delete process.env.LLM_RULE_LANGUAGE;
      expect(new LLMConfigManager().getDefaultRuleLanguage()).toBe("auto");
    });
  });
});
