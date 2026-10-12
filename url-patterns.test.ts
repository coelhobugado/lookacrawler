import { describe, it, expect } from "bun:test";
import { compileUrlPatterns } from "./crawler.js";

describe("compileUrlPatterns", () => {
  it("matches substrings and * wildcards", () => {
    const [docs, glob] = compileUrlPatterns(["/docs/", "/blog/*/2026"], "include");
    expect(docs("https://example.com/docs/intro")).toBe(true);
    expect(docs("https://example.com/blog")).toBe(false);
    expect(glob("/blog/news/2026/x")).toBe(true);
    expect(glob("/blog/2025")).toBe(false);
  });

  it("caps count and length", () => {
    expect(() => compileUrlPatterns(Array.from({ length: 11 }, () => "a"), "include")).toThrow("max 10");
    expect(() => compileUrlPatterns(["a".repeat(201)], "exclude")).toThrow("max 200");
  });

  it("treats regex syntax literally, so catastrophic patterns stay linear", () => {
    const [m] = compileUrlPatterns(["^(([a-z/:.])+)+$"], "exclude");
    const start = performance.now();
    expect(m("https://" + "a".repeat(100_000) + "!")).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
