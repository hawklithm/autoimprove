import { describe, expect, it } from "vitest";
import { InfoClassifier } from "../src/core/info-classifier.js";

describe("InfoClassifier", () => {
  const classifier = new InfoClassifier();

  it("classifies an explicit preference as preference", () => {
    const r = classifier.classify({ content: "我们团队约定所有对外 API 都要加超时与重试" });
    expect(r.info_class).toBe("preference");
    expect(r.is_one_time).toBe(false);
  });

  it("classifies a correction-with-technical-detail as experience", () => {
    const r = classifier.classify({ content: "应该避免在循环中创建新的对象实例，改为复用对象池以减少 GC 压力" });
    expect(r.info_class).toBe("experience");
    expect(r.is_one_time).toBe(false);
  });

  it("classifies an objective environment statement as fact", () => {
    const r = classifier.classify({ content: "配置文件位于 config/settings.json，由部署脚本读取" });
    expect(r.info_class).toBe("fact");
    expect(r.is_one_time).toBe(false);
  });

  it("flags a request/one-time message as one-time (not classifiable)", () => {
    const r = classifier.classify({ content: "请帮我看看这个报错是怎么回事" });
    expect(r.is_one_time).toBe(true);
    expect(r.info_class).toBeUndefined();
  });

  it("flags session-continuation residue as one-time", () => {
    const r = classifier.classify({ content: "This session is being continued from a previous conversation." });
    expect(r.is_one_time).toBe(true);
  });

  it("detects sensitive content", () => {
    expect(classifier.detectSensitivity("my api_key is sk-abcdefghijklmnopqrstuvw")).toBe("sensitive");
    expect(classifier.detectSensitivity("use the refreshToken helper here")).toBe("public");
  });

  it("flags realistic secret formats as sensitive", () => {
    expect(classifier.detectSensitivity("aws access key AKIAIOSFODNN7EXAMPLE")).toBe("sensitive");
    expect(classifier.detectSensitivity("token: \"ghp_abcdefghijklmnopqrstuvwxyz0123456789\"")).toBe("sensitive");
    expect(classifier.detectSensitivity("password=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY")).toBe("sensitive");
    expect(classifier.detectSensitivity("DB_URL=postgres://user:secretpw@db.internal:5432/app")).toBe("sensitive");
    expect(classifier.detectSensitivity("connect to 192.168.1.50 on port 5432")).toBe("sensitive");
  });

  it("keeps ordinary technical chat public", () => {
    expect(classifier.detectSensitivity("we use async/await instead of callbacks in the api module")).toBe("public");
    expect(classifier.detectSensitivity("the refreshToken helper handles expiry")).toBe("public");
  });
});
