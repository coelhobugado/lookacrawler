import { describe, expect, test, beforeEach } from "bun:test";
import {
  analyzeEmail,
  checkMx,
  classifyEmail,
  cleanEmail,
  cleanEmails,
  clearMxCache,
  deobfuscate,
  findEmails,
} from "./email.js";

describe("Email cleaning (quality/email.ts)", () => {
  test("lowercases, strips mailto and decodes", () => {
    expect(cleanEmail("mailto:%20Contato@LookaDev.com?subject=Oi")).toBe("contato@lookadev.com");
    expect(cleanEmail("<vendas@loja.com.br>.")).toBe("vendas@loja.com.br");
  });

  test("rejects placeholders, vendor domains and asset names", () => {
    expect(cleanEmail("user@example.com")).toBeNull();
    expect(cleanEmail("seuemail@gmail.com")).toBeNull();
    expect(cleanEmail("contato@dominio.com.br")).toBeNull();
    expect(cleanEmail("abc@o123.ingest.sentry.io")).toBeNull();
    expect(cleanEmail("x@sentry-next.wixpress.com")).toBeNull();
    expect(cleanEmail("logo@2x.png")).toBeNull();
    expect(cleanEmail("banner@1.5x.webp")).toBeNull();
    expect(cleanEmail("icon@2x.retina.com")).toBeNull();
    expect(cleanEmail("arquivo@empresa.pdf")).toBeNull();
    expect(cleanEmail("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6@errors.app.io")).toBeNull();
  });

  test("rejects malformed addresses", () => {
    expect(cleanEmail("a..b@empresa.com")).toBeNull();
    expect(cleanEmail(".a@empresa.com")).toBeNull();
    expect(cleanEmail("a@b@empresa.com")).toBeNull();
    expect(cleanEmail("nome@-empresa.com")).toBeNull();
    expect(cleanEmail("nome@empresa")).toBeNull();
  });

  test("does not drop real providers that share a suffix with a blocked domain", () => {
    expect(cleanEmail("maria@gmail.com")).toBe("maria@gmail.com");
    expect(cleanEmail("joao@meusite.com.br")).toBe("joao@meusite.com.br");
  });

  test("cleanEmails dedupes and keeps order", () => {
    expect(cleanEmails(["B@x.com.br", "a@x.com.br", "b@x.com.br", "user@example.com"])).toEqual([
      "b@x.com.br",
      "a@x.com.br",
    ]);
  });

  test("classifies role vs personal mailboxes", () => {
    for (const e of ["contato@x.com", "vendas@x.com", "financeiro@x.com", "sac@x.com", "info@x.com", "contato.sp@x.com", "vendas2@x.com"]) {
      expect(classifyEmail(e)).toBe("role");
    }
    for (const e of ["maria@x.com", "joao.silva@x.com", "dr.carlos@x.com"]) {
      expect(classifyEmail(e)).toBe("personal");
    }
  });

  test("analyzeEmail reports provider, disposable and site match", () => {
    expect(analyzeEmail("maria@gmail.com").freeProvider).toBe(true);
    expect(analyzeEmail("a@mailinator.com").disposable).toBe(true);
    expect(analyzeEmail("contato@lookadev.com", "https://www.lookadev.com/contato").matchesSite).toBe(true);
    expect(analyzeEmail("contato@outra.com", "https://lookadev.com").matchesSite).toBe(false);
  });
});

describe("Email deobfuscation", () => {
  test("decodes bracketed at/dot and spaced @", () => {
    expect(deobfuscate("contato [at] empresa [dot] com")).toBe("contato@empresa.com");
    expect(deobfuscate("vendas(arroba)loja(ponto)com(ponto)br")).toBe("vendas@loja.com.br");
    expect(deobfuscate("nome @ empresa.com.br")).toBe("nome@empresa.com.br");
    expect(deobfuscate("look at this")).toBe("look at this");
  });

  test("findEmails returns plain and obfuscated addresses", () => {
    const text = "Escreva para comercial@lookadev.com ou suporte {at} lookadev {dot} com. Imagem: logo@2x.png";
    expect(findEmails(text).sort()).toEqual(["comercial@lookadev.com", "suporte@lookadev.com"]);
  });

  test("runs in linear time on long hostile input", () => {
    const text = "a".repeat(50000) + " [at".repeat(20000) + " @ ".repeat(20000) + "(ponto ".repeat(20000);
    const started = performance.now();
    findEmails(text);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("MX check", () => {
  beforeEach(() => clearMxCache());

  test("caches results and distinguishes missing vs failed lookups", async () => {
    let calls = 0;
    const resolver = async (host: string) => {
      calls++;
      if (host === "semmx.com.br") throw Object.assign(new Error("nodata"), { code: "ENODATA" });
      if (host === "timeout.com.br") throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
      return [{ exchange: "mx.empresa.com.br", priority: 10 }];
    };

    expect(await checkMx("Empresa.com.br", { resolver })).toBe(true);
    expect(await checkMx("empresa.com.br", { resolver })).toBe(true);
    expect(calls).toBe(1);
    expect(await checkMx("semmx.com.br", { resolver })).toBe(false);
    expect(await checkMx("timeout.com.br", { resolver })).toBeNull();
  });
});
