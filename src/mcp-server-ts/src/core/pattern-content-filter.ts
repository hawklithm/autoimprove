/**
 * PatternContentFilter — Phase 1 / P0
 *
 * Content-type guard for the Pattern Detection layer. Its job is to stop
 * non-coding content (recruiting / marketing / product / sales chatter) from
 * ever becoming a "programming pattern" — the exact failure mode behind
 * rule-001.
 *
 * The detector is deliberately heuristic and cheap (pure string matching, no
 * LLM). It exposes `isCodeRelated(text)` which returns `{ allowed, reason,
 * category }`. Callers in SessionAnalyzer (and downstream Memory Extraction)
 * use it to drop patterns/memories whose text is business-dominant.
 *
 * A more expensive LLM-based classifier lives in `PatternSemanticClassifier`
 * and is only consulted when this heuristic is inconclusive.
 */

export type ContentCategory = "code" | "business" | "mixed" | "general";

export interface ContentFilterResult {
  /** true when the content is allowed to become a coding pattern/memory */
  allowed: boolean;
  /** human-readable reason, useful for logging/debugging */
  reason: string;
  /** coarse classification of the content */
  category: ContentCategory;
  /** number of distinct code keywords matched */
  codeScore: number;
  /** number of distinct business keywords matched */
  businessScore: number;
}

/**
 * Keywords that strongly indicate *programming / engineering* content.
 * Grouped for readability; merged into one set at construction time.
 */
const CODE_KEYWORDS: string[] = [
  // Languages
  "typescript", "javascript", "python", "java", "golang", "rust", "c++", "c#",
  "php", "ruby", "kotlin", "swift", "scala", "dart", "elixir", "haskell",
  "lua", "perl", "sql", "bash", "shell", "html", "css", "go",
  // Frameworks / libraries
  "react", "vue", "angular", "node", "nodejs", "express", "nextjs", "next.js",
  "nuxt", "django", "flask", "fastapi", "spring", "springboot", "rails",
  "laravel", "symfony", ".net", "tensorflow", "pytorch", "pandas", "numpy",
  "scikit", "keras", "graphql", "apollo", "redux", "webpack", "vite",
  "rollup", "babel", "jest", "mocha", "playwright", "cypress", "selenium",
  "docker", "kubernetes", "k8s", "terraform", "ansible", "aws", "gcp",
  "azure", "lambda", "prisma", "drizzle", "sequelize", "typeorm", "rxjs",
  "jquery", "bootstrap", "tailwind", "echarts", "redis", "postgres",
  "mysql", "sqlite", "mongodb",
  // Engineering concepts
  "function", "class", "interface", "method", "variable", "loop", "array",
  "object", "async", "await", "promise", "callback", "closure", "recursion",
  "algorithm", "data structure", "api", "rest", "endpoint", "middleware",
  "route", "controller", "service", "repository", "database", "query",
  "index", "cache", "pipeline", "ci/cd", "deployment", "server", "client",
  "frontend", "front-end", "backend", "back-end", "compile", "build", "debug",
  "test", "refactor", "lint", "type", "generics", "decorator", "annotation",
  "import", "export", "dependency", "package", "module", "namespace",
  "commit", "branch", "merge", "pull request", "unit test", "integration test",
  "typescript", "javascript",
];

/**
 * Keywords that strongly indicate *business* content (recruiting / marketing /
 * product / sales). Matched case-insensitively.
 */
const BUSINESS_KEYWORDS: string[] = [
  // 招聘 recruiting
  "招聘", "简历", "候选人", "面试", "岗位", "招聘需求", "猎头", "录用", "入职",
  "招聘流程", "人才", "offer", "招聘会",
  "hiring", "recruitment", "candidate", "resume", "cv", "interview",
  "job posting", "onboarding", "headhunt",
  // 营销 marketing
  "营销", "推广", "广告", "投放", "转化率", "曝光", "流量", "活动策划", "文案",
  "品牌", "公关", "拉新", "获客", "种草",
  "marketing", "campaign", "advertisement", "conversion rate", "lead",
  "funnel", "seo", "sem", "promotion", "branding", "growth hacking",
  // 产品 product
  "产品需求", "需求文档", "原型", "用户故事", "路线图", "迭代", "上线", "功能规划",
  "竞品", "用户调研", "产品规划",
  "product", "roadmap", "backlog", "user story", "prototype", "mvp",
  "feature", "competitor analysis",
  // 销售 sales
  "销售", "客户", "订单", "成交", "签约", "回款", "客单价", "销售线索", "商机",
  "销售额", "渠道",
  "sales", "customer", "deal", "contract", "quota", "crm", "pipeline",
  "revenue", "sales lead",
  // 通用商业 general business
  "商业模式", "营收", "利润", "成本", "市场份额", "战略", "运营", "用户增长",
  "留存", "流失率", "毛利率",
  "business model", "profit", "strategy", "growth", "retention", "churn",
  "market share", "roi",
];

/** Short tokens that must be matched as whole words to avoid false positives. */
const SHORT_TOKENS = new Set(["go", "c", "r", "sql", "api", "ci"]);

export interface PatternContentFilterOptions {
  /** Override the code keyword dictionary (mainly for tests). */
  codeKeywords?: string[];
  /** Override the business keyword dictionary (mainly for tests). */
  businessKeywords?: string[];
  /**
   * Business-dominance threshold. When business/(business+code) exceeds this
   * the content is rejected even if some code keywords are present.
   */
  businessRatioThreshold?: number;
}

export class PatternContentFilter {
  private readonly codeSet: Set<string>;
  private readonly businessSet: Set<string>;
  private readonly businessRatioThreshold: number;

  constructor(options: PatternContentFilterOptions = {}) {
    this.codeSet = new Set(
      (options.codeKeywords ?? CODE_KEYWORDS).map((k) => k.toLowerCase())
    );
    this.businessSet = new Set(
      (options.businessKeywords ?? BUSINESS_KEYWORDS).map((k) => k.toLowerCase())
    );
    this.businessRatioThreshold = options.businessRatioThreshold ?? 0.6;
  }

  /**
   * Decide whether `text` is code-related and therefore allowed to become a
   * pattern/memory. Pure, synchronous, no I/O.
   */
  isCodeRelated(text: string): ContentFilterResult {
    const t = (text || "").toLowerCase();
    if (!t.trim()) {
      return { allowed: true, reason: "empty content treated as general", category: "general", codeScore: 0, businessScore: 0 };
    }

    const codeScore = this.countHits(t, this.codeSet);
    const businessScore = this.countHits(t, this.businessSet);

    // No decisive signal on either axis → keep it (avoid over-filtering).
    if (codeScore === 0 && businessScore === 0) {
      return { allowed: true, reason: "no decisive signal (general content)", category: "general", codeScore, businessScore };
    }

    // Pure business: business terms present but zero code signal.
    if (codeScore === 0 && businessScore > 0) {
      return { allowed: false, reason: "pure business content (no code signal)", category: "business", codeScore, businessScore };
    }

    const ratio = businessScore / (codeScore + businessScore);

    // Mixed but business-dominant → reject.
    if (ratio > this.businessRatioThreshold) {
      return {
        allowed: false,
        reason: `business-dominant content (business ratio ${ratio.toFixed(2)} > ${this.businessRatioThreshold})`,
        category: "business",
        codeScore,
        businessScore,
      };
    }

    // Code-relevant (optionally with some business context).
    const category: ContentCategory = ratio <= 0.3 ? "code" : "mixed";
    return {
      allowed: true,
      reason: category === "code" ? "code-relevant content" : "mixed content but code-relevant",
      category,
      codeScore,
      businessScore,
    };
  }

  /**
   * Count how many distinct keywords from `set` appear in `text`.
   * Short/ambiguous tokens are matched as whole words; the rest as substrings.
   */
  private countHits(text: string, set: Set<string>): number {
    let count = 0;
    for (const kw of set) {
      if (this.contains(text, kw)) count++;
    }
    return count;
  }

  private contains(text: string, keyword: string): boolean {
    if (SHORT_TOKENS.has(keyword)) {
      // Whole-word match for ambiguous short tokens (e.g. "go" must not match "google").
      const re = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i");
      return re.test(text);
    }
    return text.includes(keyword);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
