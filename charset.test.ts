import { describe, it, expect } from "bun:test";
import { decodeHtml } from "./extractor.js";

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe("decodeHtml", () => {
  it("uses the Content-Type charset", () => {
    expect(decodeHtml(latin1("<p>Ação</p>"), "text/html; charset=ISO-8859-1")).toBe("<p>Ação</p>");
  });

  it("falls back to <meta charset>", () => {
    const html = '<html><head><meta charset="windows-1252"></head><body>Promoção</body></html>';
    expect(decodeHtml(latin1(html), "text/html")).toContain("Promoção");
  });

  it("defaults to UTF-8 and survives unknown labels", () => {
    const utf8 = new TextEncoder().encode("<p>Ação</p>");
    expect(decodeHtml(utf8, null)).toBe("<p>Ação</p>");
    expect(decodeHtml(utf8, "text/html; charset=x-bogus")).toBe("<p>Ação</p>");
  });

  it("honours a UTF-8 BOM over a wrong header", () => {
    const body = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("Ação")]);
    expect(decodeHtml(body, "text/html; charset=iso-8859-1")).toEndWith("Ação");
  });
});
