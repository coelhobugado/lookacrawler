import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { JSDOM } from "jsdom";
import { extractContacts, parseContactsFromDocument, parseContactsFromHtml } from "./contacts.js";

const BR_HOME = `<!DOCTYPE html>
<html>
  <body>
    <header>
      <a href="/cardapio/sobremesas">Sobremesas</a>
      <a href="/steam-cleaning">Steam cleaning</a>
      <a href="/equipe">Nossa equipe</a>
      <a href="/quem-somos">Quem somos</a>
      <a href="/fale-conosco">Fale conosco</a>
      <a href="/catalogo.pdf">Contato comercial (PDF)</a>
      <a href="https://outro-site.com.br/contato">Parceiro</a>
    </header>
    <a href="tel:+5562999999999">Ligue</a>
    <p>WhatsApp (62) 99999-9999 ou +55 62 99999-9999. Fixo: (62) 3333-4444.</p>
    <p>Escreva para orcamento [at] lookadev [dot] com</p>
    <script>var cfg = { cpf: "123.456.789-09", tel: "(11) 98888-7777" };</script>
    <footer>
      LookADev LTDA - CNPJ 04.740.714/0001-97 - CPF 123.456.789-09 - CEP 74000-000
      <a href="https://wa.me/5562999999999">WhatsApp</a>
    </footer>
  </body>
</html>`;

describe("Contact parsing quality (contacts.ts)", () => {
  test("dedupes phones by E.164 and keeps a formatted value", () => {
    const found = parseContactsFromHtml(BR_HOME, "https://lookadev.com.br/");
    const e164s = found.phones.map((p) => p.e164).sort();
    expect(e164s).toEqual(["+556233334444", "+5562999999999"]);

    const mobile = found.phones.find((p) => p.e164 === "+5562999999999")!;
    expect(mobile.formatted).toBe("(62) 99999-9999");
    expect(mobile.type).toBe("mobile");
    expect(mobile.origin).toBe("tel");
    expect(found.phones.find((p) => p.e164 === "+556233334444")!.type).toBe("fixed");
  });

  test("never reports CPF, CEP or script content as phones", () => {
    const found = parseContactsFromHtml(BR_HOME, "https://lookadev.com.br/");
    expect(found.phones.some((p) => p.e164.includes("12345678909"))).toBe(false);
    expect(found.phones.some((p) => p.e164 === "+5511988887777")).toBe(false);
  });

  test("decodes obfuscated emails and extracts the footer CNPJ", () => {
    const found = parseContactsFromHtml(BR_HOME, "https://lookadev.com.br/");
    expect(found.emails).toContain("orcamento@lookadev.com");
    expect(found.cnpjs).toEqual(["04740714000197"]);
  });

  test("ranks contact subpages by priority and whole words only", () => {
    const found = parseContactsFromHtml(BR_HOME, "https://lookadev.com.br/");
    expect(found.contactLinks).toEqual([
      "https://lookadev.com.br/fale-conosco",
      "https://lookadev.com.br/quem-somos",
      "https://lookadev.com.br/equipe",
    ]);
  });

  test("parseContactsFromDocument leaves the document untouched", () => {
    const dom = new JSDOM(BR_HOME, { url: "https://lookadev.com.br/" });
    const doc = dom.window.document;
    const before = doc.querySelectorAll("script").length;
    parseContactsFromDocument(doc, "https://lookadev.com.br/");
    expect(doc.querySelectorAll("script").length).toBe(before);
  });
});

describe("extractContacts with prefetched html", () => {
  let server: ReturnType<typeof Bun.serve>;
  let serverUrl: string;
  const hits: string[] = [];

  beforeAll(() => {
    process.env.LOOKACRAWLER_ALLOW_LOCAL = "true";
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        hits.push(path);
        if (path === "/fale-conosco") {
          return new Response(
            `<html><body><a href="tel:(62)3333-4444">Central</a><p>financeiro@lookadev.com.br</p></body></html>`,
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
        return new Response("<html><body>vazio</body></html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
    });
    serverUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    delete process.env.LOOKACRAWLER_ALLOW_LOCAL;
    server.stop(true);
  });

  test("does not refetch the root and visits subpages in priority order", async () => {
    hits.length = 0;
    const result = await extractContacts({ url: `${serverUrl}/`, html: BR_HOME, maxSubpages: 1 });

    expect(hits).toEqual(["/fale-conosco"]);
    expect(result.contactPagesScanned).toEqual([`${serverUrl}/`, `${serverUrl}/fale-conosco`]);
    expect(result.emails).toContain("financeiro@lookadev.com.br");
    // The landline appears in text on the home and as tel: on the subpage: one entry.
    expect(result.phones.filter((p) => p === "(62) 3333-4444").length).toBe(1);
    expect(result.phoneDetails?.find((p) => p.e164 === "+5562999999999")?.whatsapp).toBe(true);
    expect(result.cnpjs).toEqual(["04740714000197"]);
  });
});
