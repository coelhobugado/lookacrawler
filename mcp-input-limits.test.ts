import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** Call a tool and return its error text, whether the SDK throws or returns isError. */
async function callForError(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  try {
    const result: any = await client.callTool({ name, arguments: args });
    expect(result.isError).toBe(true);
    return result.content.map((c: any) => c.text).join("\n");
  } catch (error: any) {
    return String(error?.message || error);
  }
}

describe("MCP tool input limits", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: "limits-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: "bun", args: ["index.ts"], cwd: import.meta.dir, stderr: "ignore" }));
  }, 20000);

  afterAll(async () => {
    await client?.close();
  });

  it("rejects unbounded page action waits, scrolls and counts", async () => {
    const url = "https://example.com";
    expect(await callForError(client, "extract_web_content", { url, mode: "deep", actions: [{ type: "wait", milliseconds: 600000 }] })).toMatch(/milliseconds|too_big|10000/i);
    expect(await callForError(client, "extract_web_content", { url, mode: "deep", actions: [{ type: "scroll", pixels: 1e9 }] })).toMatch(/pixels|too_big|20000/i);
    const many = Array.from({ length: 21 }, () => ({ type: "wait", milliseconds: 1 }));
    expect(await callForError(client, "extract_web_content", { url, mode: "deep", actions: many })).toMatch(/actions|too_big|20/i);
  });

  it("rejects too many or too long crawl patterns", async () => {
    const start_url = "https://example.com";
    expect(await callForError(client, "crawl_website", { start_url, include_patterns: Array.from({ length: 11 }, () => "/docs/") })).toMatch(/include_patterns|too_big|10/i);
    expect(await callForError(client, "crawl_website", { start_url, exclude_patterns: ["a".repeat(201)] })).toMatch(/exclude_patterns|too_big|200/i);
  });
});
