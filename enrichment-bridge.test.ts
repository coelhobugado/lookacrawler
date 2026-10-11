import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { deepEnrichLead } from "./enrichment-bridge.js";

const HOME = `<!DOCTYPE html>
<html>
  <head><title>Clínica Exemplo</title></head>
  <body>
    <nav><a href="/contato">Contato</a><a href="/blog">Blog</a></nav>
    <main><article>
      <h1>Clínica Exemplo</h1>
      <p>${"Atendimento odontológico completo em Goiânia com equipe especializada. ".repeat(6)}</p>
      <p>Ligue (62) 3333-4444 ou +55 62 99999-9999. Diretor: Carlos Almeida.</p>
      <p>Desde 2019-2026. CNPJ 04.740.714/0001-97 | CPF 123.456.789-09 | CEP 74000-000.</p>
    </article></main>
    <footer>
      <a href="tel:+5562999999999">WhatsApp</a>
      <a href="tel:(62)3333-4444">Fixo</a>
      <a href="mailto:Contato@ClinicaExemplo.com.br">Contato@ClinicaExemplo.com.br</a>
      <a href="https://instagram.com/clinicaexemplo">Instagram</a>
      <a href="https://wa.me/5562999999999">Chat</a>
    </footer>
  </body>
</html>`;

const CONTACT = `<!DOCTYPE html>
<html><body>
  <h1>Contato</h1>
  <p>Agendamentos: agendamento@clinicaexemplo.com.br - (62) 3333-5555</p>
</body></html>`;

describe("Lead enrichment pipeline (enrichment-bridge.ts)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let serverUrl: string;
  const hits: Record<string, number> = {};

  beforeAll(() => {
    process.env.LOOKACRAWLER_ALLOW_LOCAL = "true";
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        hits[path] = (hits[path] || 0) + 1;
        const html = path === "/" ? HOME : path === "/contato" ? CONTACT : null;
        if (!html) return new Response("Not Found", { status: 404 });
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      },
    });
    serverUrl = `http://localhost:${server.port}/`;
  });

  afterAll(() => {
    delete process.env.LOOKACRAWLER_ALLOW_LOCAL;
    server.stop(true);
  });

  test("fetches the home and the contact page once each", async () => {
    for (const k of Object.keys(hits)) delete hits[k];
    const result = await deepEnrichLead({ title: "Clínica Exemplo", web_site: serverUrl });

    expect(result.enrichmentSuccess).toBe(true);
    expect(hits["/"]).toBe(1);
    expect(hits["/contato"]).toBe(1);
    expect(result.sourcePagesCrawled).toEqual([serverUrl, `${serverUrl}contato`]);
    expect(result.markdownSummary).toContain("Clínica Exemplo");
  });

  test("a markdown cache hit still fetches the home html only once", async () => {
    for (const k of Object.keys(hits)) delete hits[k];
    await deepEnrichLead({ title: "Clínica Exemplo", web_site: serverUrl }, { crawlContactPages: false });
    expect(hits["/"]).toBe(1);
    expect(hits["/contato"]).toBeUndefined();
  });

  test("dedupes phones by E.164 across Maps, tel: links and text", async () => {
    const result = await deepEnrichLead({
      title: "Clínica Exemplo",
      web_site: serverUrl,
      phone: "+55 62 3333-4444",
      complete_address: { country: "BR" },
    });

    // The Maps phone (also a tel: link and in the text) is not repeated.
    expect(result.additionalPhones).toEqual(["(62) 3333-5555", "(62) 99999-9999"]);
    // CPF, CEP and the year range are never phones.
    expect(result.additionalPhones.some((p) => /123|74000|2019/.test(p))).toBe(false);
    // The MCP output stays compact: no per-field detail blobs.
    for (const k of ["phoneDetails", "emailDetails", "collectedAt"]) expect(k in result).toBe(false);
  });

  test("cleans and merges emails from Maps and the site", async () => {
    const result = await deepEnrichLead({
      title: "Clínica Exemplo",
      web_site: serverUrl,
      emails: ["CONTATO@clinicaexemplo.com.br", "user@example.com"],
    });

    expect(result.emails).toEqual(["contato@clinicaexemplo.com.br", "agendamento@clinicaexemplo.com.br"]);
    expect(result.cnpjFromSite).toEqual(["04740714000197"]);
    expect(result.markdownSummary).toContain("04.740.714/0001-97");
  });
});
