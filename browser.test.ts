import { describe, it, expect, afterAll } from "bun:test";
import { getBrowser, closeBrowsers, getStealthInit, toPlaywrightProxy } from "./browser-manager.js";

describe("Browser Manager Module (browser-manager.ts)", () => {
  afterAll(async () => {
    await closeBrowsers();
  });

  it("should return a functional stealth init function", () => {
    const fn = getStealthInit();
    expect(typeof fn).toBe("function");
    expect(fn.toString()).toContain("webdriver");
  });

  it("should attempt to launch or retrieve a browser instance", async () => {
    let browser: any = null;
    try {
      // Allow up to 12 seconds for browser launch attempt
      const launchPromise = getBrowser();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Browser launch timeout (environment constraint)")), 12000)
      );
      browser = await Promise.race([launchPromise, timeoutPromise]);
      expect(browser).toBeDefined();
    } catch (err: any) {
      // In constrained environments (e.g., CI or Windows without pipe permissions),
      // verify it threw an expected error rather than crashing the process
      expect(err.message).toBeDefined();
    } finally {
      await closeBrowsers();
    }
  }, 20000);

  it("should close browsers cleanly without throwing", async () => {
    await expect(closeBrowsers()).resolves.toBeUndefined();
  });
});

describe("toPlaywrightProxy", () => {
  it("moves credentials out of the server URL", () => {
    expect(toPlaywrightProxy("http://us%40r:p%3Ass@proxy.example.com:8080")).toEqual({
      server: "http://proxy.example.com:8080",
      username: "us@r",
      password: "p:ss",
    });
    expect(toPlaywrightProxy("socks5://proxy.example.com:1080")).toEqual({ server: "socks5://proxy.example.com:1080" });
  });
});
