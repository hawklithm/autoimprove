/**
 * Scene detection for AutoImprove.
 *
 * Detects three-dimensional scenes: tech stack, functional domain, business domain.
 */

import { Scene, createScene } from "./models.js";

// Tech stack detection patterns
const TECH_PATTERNS: Record<string, string[]> = {
  react: [".jsx", ".tsx", "react", "useState", "useEffect", "jsx"],
  vue: [".vue", "vue", "reactive", "ref", "computed"],
  angular: [".component.ts", "angular", "ngOnInit", "@Component"],
  typescript: [".ts", ".tsx", "typescript", "interface", "type"],
  javascript: [".js", ".jsx", "javascript"],
  python: [".py", "python", "def ", "import "],
  java: [".java", "java", "public class", "import java"],
  go: [".go", "golang", "func ", "package "],
  rust: [".rs", "rust", "fn ", "use "],
  nextjs: ["next.config", "getServerSideProps", "getStaticProps"],
  express: ["express", "app.get", "app.post", "middleware"],
  fastapi: ["fastapi", "FastAPI", "@app.get", "@app.post"],
  django: ["django", "models.Model", "views.py", "urls.py"]
};

// Functional domain detection patterns
const FUNCTIONAL_PATTERNS: Record<string, string[]> = {
  auth: [
    "auth",
    "login",
    "logout",
    "signin",
    "signup",
    "authentication",
    "authorization",
    "token",
    "session"
  ],
  api: ["api", "endpoint", "route", "controller", "service"],
  database: ["database", "db", "model", "schema", "migration", "query"],
  ui: ["component", "ui", "view", "page", "layout", "style"],
  test: ["test", "spec", "__tests__", "testing"],
  config: ["config", "settings", "env", "configuration"],
  utils: ["util", "helper", "common", "shared"],
  middleware: ["middleware", "interceptor", "guard"]
};

// Business domain keywords
const BUSINESS_KEYWORDS: Record<string, string[]> = {
  "e-commerce": [
    "cart",
    "checkout",
    "payment",
    "order",
    "product",
    "inventory",
    "shipping"
  ],
  social: ["post", "comment", "like", "follow", "feed", "profile", "friend"],
  finance: ["transaction", "account", "balance", "invoice", "billing", "payment"],
  healthcare: ["patient", "doctor", "appointment", "medical", "diagnosis", "prescription"],
  education: ["course", "student", "teacher", "lesson", "assignment", "grade"],
  crm: ["customer", "lead", "opportunity", "contact", "deal", "pipeline"]
};

export class SceneDetector {
  constructor(private businessDomainConfig: Record<string, string> = {}) {}

  detectScene(filePaths: string[], contentSamples?: string[]): Scene {
    const tech = this.detectTechStack(filePaths, contentSamples);
    const functional = this.detectFunctionalDomain(filePaths);
    const business = this.detectBusinessDomain(filePaths, contentSamples);

    return createScene({ tech, functional, business });
  }

  private detectTechStack(filePaths: string[], contentSamples?: string[]): string[] {
    const detected = new Set<string>();

    // Check file extensions and paths
    for (const path of filePaths) {
      const pathLower = path.toLowerCase();
      for (const [tech, patterns] of Object.entries(TECH_PATTERNS)) {
        if (patterns.some(pattern => pathLower.includes(pattern))) {
          detected.add(tech);
        }
      }
    }

    // Check content if provided
    if (contentSamples) {
      for (const content of contentSamples) {
        const contentLower = content.toLowerCase();
        for (const [tech, patterns] of Object.entries(TECH_PATTERNS)) {
          if (patterns.some(pattern => contentLower.includes(pattern))) {
            detected.add(tech);
          }
        }
      }
    }

    return Array.from(detected).sort();
  }

  private detectFunctionalDomain(filePaths: string[]): string[] {
    const detected = new Set<string>();

    for (const path of filePaths) {
      const pathLower = path.toLowerCase();
      const parts = pathLower.replace(/\\/g, "/").split("/");

      for (const [domain, patterns] of Object.entries(FUNCTIONAL_PATTERNS)) {
        if (parts.some(part => patterns.some(pattern => part.includes(pattern)))) {
          detected.add(domain);
        }
      }
    }

    return Array.from(detected).sort();
  }

  private detectBusinessDomain(filePaths: string[], contentSamples?: string[]): string[] {
    const detected = new Set<string>();

    // Check configured mappings first
    for (const path of filePaths) {
      for (const [pattern, domain] of Object.entries(this.businessDomainConfig)) {
        if (path.includes(pattern)) {
          detected.add(domain);
        }
      }
    }

    // Infer from keywords
    let allText = filePaths.join(" ").toLowerCase();
    if (contentSamples) {
      allText += " " + contentSamples.join(" ").toLowerCase();
    }

    for (const [domain, keywords] of Object.entries(BUSINESS_KEYWORDS)) {
      if (keywords.some(kw => allText.includes(kw))) {
        detected.add(domain);
      }
    }

    return Array.from(detected).sort();
  }

  calculateSceneConfidence(
    scene: Scene,
    fileCount: number
  ): Record<string, number> {
    const confidences: Record<string, number> = {};

    // Tech stack confidence
    if (scene.tech.length > 0) {
      confidences.tech = Math.min(scene.tech.length / Math.max(fileCount, 1) + 0.5, 1.0);
    } else {
      confidences.tech = 0.0;
    }

    // Functional domain confidence
    if (scene.functional.length > 0) {
      confidences.functional = scene.functional.length <= 2 ? 0.8 : 0.6;
    } else {
      confidences.functional = 0.0;
    }

    // Business domain confidence
    if (scene.business.length > 0) {
      // Assume higher confidence if from config
      confidences.business = 0.7;
    } else {
      confidences.business = 0.0;
    }

    return confidences;
  }

  addBusinessDomainMapping(pathPattern: string, domain: string): void {
    this.businessDomainConfig[pathPattern] = domain;
  }

  detectFromSessionData(filePaths: string[], userMessages: string[]): Scene {
    // Use user messages as content samples (limit to first 10)
    const contentSamples = userMessages.slice(0, 10);
    return this.detectScene(filePaths, contentSamples);
  }
}
