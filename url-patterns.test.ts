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

  it("rejects regex syntax instead of silently matching it literally", () => {
    for (const p of ["^(([a-z/:.])+)+$", "logout|admin", "\\.pdf$", "/docs/.*", "[0-9]+"]) {
      expect(() => compileUrlPatterns([p], "exclude")).toThrow("not regexes");
    }
    expect(compileUrlPatterns(["/search?q=", "/a+b/", "*.pdf"], "exclude")).toHaveLength(3);
  });

  it("stays linear on long hostile URLs", () => {
    const [m] = compileUrlPatterns(["/a*a*a*a*a*b"], "exclude");
    const start = performance.now();
    expect(m("/" + "a".repeat(100_000))).toBe(false);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
