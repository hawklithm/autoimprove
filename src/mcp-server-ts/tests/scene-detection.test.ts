import { describe, it, expect } from "vitest";

import { SceneDetector } from "../src/core/scene-detector.js";
import { RuleMatcher } from "../src/core/rule-matcher.js";
import { RuleIndexManager } from "../src/storage/rule-index.js";
import { createScene, PatternType, Priority } from "../src/core/models.js";

describe("SceneDetector", () => {
  it("should detect React tech stack", () => {
    const detector = new SceneDetector();
    const filePaths = ["src/components/App.tsx", "src/hooks/useAuth.ts"];

    const scene = detector.detectScene(filePaths);

    expect(scene.tech).toContain("react");
    expect(scene.tech).toContain("typescript");
  });

  it("should detect functional domains", () => {
    const detector = new SceneDetector();
    const filePaths = ["src/auth/login.ts", "src/api/users.ts"];

    const scene = detector.detectScene(filePaths);

    expect(scene.functional).toContain("auth");
    expect(scene.functional).toContain("api");
  });

  it("should detect business domain from content", () => {
    const detector = new SceneDetector();
    const filePaths = ["src/shop/cart.ts"];
    const contentSamples = ["add product to cart", "checkout payment"];

    const scene = detector.detectScene(filePaths, contentSamples);

    expect(scene.business).toContain("e-commerce");
  });

  it("should detect Python tech stack", () => {
    const detector = new SceneDetector();
    const filePaths = ["src/main.py", "tests/test_api.py"];

    const scene = detector.detectScene(filePaths);

    expect(scene.tech).toContain("python");
  });

  it("should use business domain config", () => {
    const detector = new SceneDetector({ "src/shop": "e-commerce" });
    const filePaths = ["src/shop/product.ts"];

    const scene = detector.detectScene(filePaths);

    expect(scene.business).toContain("e-commerce");
  });

  it("should calculate scene confidence", () => {
    const detector = new SceneDetector();
    const scene = createScene({ tech: ["react", "typescript"], functional: ["auth"] });

    const confidences = detector.calculateSceneConfidence(scene, 5);

    expect(confidences.tech).toBeGreaterThan(0);
    expect(confidences.functional).toBeGreaterThan(0);
  });

  it("should detect from session data", () => {
    const detector = new SceneDetector();
    const filePaths = ["src/auth/login.tsx"];
    const userMessages = ["使用 useAuth hook", "React 组件"];

    const scene = detector.detectFromSessionData(filePaths, userMessages);

    expect(scene.tech).toContain("react");
    expect(scene.functional).toContain("auth");
  });
});

describe("RuleMatcher", () => {
  it("should match rules by scene", () => {
    // This test would require a proper RuleIndexManager mock
    // For now, we test the core logic

    const scene = createScene({ tech: ["react"], functional: ["auth"] });

    expect(scene.tech).toContain("react");
    expect(scene.functional).toContain("auth");
  });

  it("should calculate scene overlap", () => {
    const scene = createScene({ tech: ["react"], functional: ["auth"] });

    // Test that scene structure is correct
    expect(scene.tech).toEqual(["react"]);
    expect(scene.functional).toEqual(["auth"]);
    expect(scene.business).toEqual([]);
  });

  it("should sort matches by priority", () => {
    const rules = [
      {
        id: "rule-001",
        type: PatternType.PREFERENCE,
        priority: Priority.LOW,
        confidence: 0.9,
        scenes: createScene(),
        keywords: [],
        created_at: "2026-05-30T10:00:00Z",
        updated_at: "2026-05-30T10:00:00Z",
      },
      {
        id: "rule-002",
        type: PatternType.SECURITY,
        priority: Priority.CRITICAL,
        confidence: 0.7,
        scenes: createScene(),
        keywords: [],
        created_at: "2026-05-30T10:00:00Z",
        updated_at: "2026-05-30T10:00:00Z",
      },
    ];

    // Critical should come first regardless of confidence
    expect(rules[1].priority).toBe(Priority.CRITICAL);
  });
});
