export type EmailKind = "role" | "personal";

export interface EmailInfo {
  email: string;
  kind: EmailKind;
  domain: string;
  /** gmail.com, hotmail.com, ... — the address is not tied to a company domain. */
  freeProvider: boolean;
  disposable: boolean;
  /** Email domain equals (or is a subdomain of) the site domain, when given. */
  matchesSite?: boolean;
}

// Bounded local part and domain labels keep the scan linear: an unbounded
// `[...]+@` restarts at every position of a long token with no "@"
// (inline JSON, base64, hashes) and takes seconds on ~100 KB of text.
export const EMAIL_REGEX = /(?<![\w.%+-])[\w.%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,24}\b/g;

// Placeholder local parts used in templates and form hints.
const PLACEHOLDER_LOCALS = new Set([
  "user", "usuario", "example", "exemplo", "test", "teste", "email", "e-mail", "seuemail", "seu-email",
  "seu.email", "seunome", "nome", "fulano", "yourname", "your-email", "youremail", "name", "johndoe",
  "john.doe", "foo", "bar",
]);

// Template, vendor and asset domains that never belong to the business itself.
const IGNORED_DOMAINS = [
  "example.com", "example.org", "example.net", "exemplo.com", "exemplo.com.br",
  "domain.com", "dominio.com", "dominio.com.br", "seudominio.com", "seudominio.com.br",
  "yourdomain.com", "mydomain.com", "site.com", "seusite.com", "seusite.com.br", "email.com",
  "sentry.io", "wixpress.com", "cloudflare.com", "schema.org", "wordpress.org", "gravatar.com",
  "w3.org", "sentry-next.wixpress.com",
];

// File extensions mistakenly captured as the end of an email domain.
const INVALID_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "webp", "avif", "gif", "bmp", "svg", "tif", "tiff", "heic", "ico",
  "css", "js", "mjs", "json", "map", "woff", "woff2", "ttf", "otf", "eot", "pdf", "mp4", "webm", "php",
]);

const ROLE_LOCALS = new Set([
  // pt-BR
  "contato", "contatos", "faleconosco", "fale-conosco", "fale.conosco", "vendas", "venda", "financeiro",
  "atendimento", "comercial", "sac", "rh", "suporte", "orcamento", "orcamentos", "agendamento",
  "agendamentos", "recepcao", "secretaria", "administrativo", "adm", "admin", "diretoria", "compras",
  "cobranca", "faturamento", "fiscal", "contabilidade", "juridico", "marketing", "imprensa", "ouvidoria",
  "pedidos", "loja", "clinica", "escritorio", "geral", "noreply", "no-reply", "naoresponda", "nao-responda",
  "trabalheconosco", "curriculos", "curriculo", "parcerias", "eventos", "reservas", "empresa",
  // en
  "info", "contact", "contacts", "sales", "support", "help", "hello", "hi", "office", "billing",
  "accounts", "hr", "jobs", "careers", "press", "media", "team", "service", "services", "customerservice",
  "webmaster", "postmaster", "hostmaster", "abuse", "privacy", "legal", "booking", "orders", "enquiries",
  "inquiries",
]);

const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br",
  "live.com", "msn.com", "yahoo.com", "yahoo.com.br", "ymail.com", "icloud.com", "me.com", "mac.com",
  "uol.com.br", "bol.com.br", "terra.com.br", "ig.com.br", "globo.com", "globomail.com", "r7.com",
  "zipmail.com.br", "protonmail.com", "proton.me", "aol.com", "gmx.com", "zoho.com",
]);

const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc",
  "throwawaymail.com", "fakeinbox.com", "mintemail.com", "emailondeck.com",
]);

function domainMatches(domain: string, list: Iterable<string>): boolean {
  for (const d of list) {
    if (domain === d || domain.endsWith(`.${d}`)) return true;
  }
  return false;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Clean and validate a single email candidate. Returns the lowercased address
 * or null for placeholders, asset file names (logo@2x.png), vendor domains,
 * tracking hashes and malformed strings.
 */
export function cleanEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let email = safeDecode(raw.trim().replace(/^mailto:/i, "").split("?")[0]).trim().toLowerCase();
  email = email.replace(/^[<("'\s]+|[>)"'.,;:\s]+$/g, "");
  if (email.length < 6 || email.length > 100) return null;

  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !/^[\w.%+-]+$/.test(local)) return null;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  if (!/^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,24}$/.test(domain)) return null;
  if (domain.split(".").some((label) => label.startsWith("-") || label.endsWith("-"))) return null;

  // Retina asset names: icon@2x.png, banner@1.5x.webp
  if (/^\d+(?:\.\d+)?x\./.test(domain)) return null;
  const ext = domain.slice(domain.lastIndexOf(".") + 1);
  if (INVALID_EXTENSIONS.has(ext)) return null;

  if (PLACEHOLDER_LOCALS.has(local)) return null;
  if (domainMatches(domain, IGNORED_DOMAINS)) return null;
  // Error-tracker DSNs and build hashes: 32 hex chars before the "@".
  if (/^[0-9a-f]{20,}$/.test(local)) return null;

  return email;
}

/**
 * Clean a list of email candidates, dropping invalid ones and duplicates while
 * keeping the original order.
 */
export function cleanEmails(rawEmails: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of rawEmails) {
    const clean = cleanEmail(raw);
    if (clean) out.add(clean);
  }
  return Array.from(out);
}

/**
 * Role mailbox (contato@, vendas@, info@ ...) vs an address that looks like a
 * person (maria@, joao.silva@).
 */
export function classifyEmail(email: string): EmailKind {
  const local = email.slice(0, email.indexOf("@")).toLowerCase();
  if (ROLE_LOCALS.has(local)) return "role";
  // contato.sp@, vendas2@, sac-goiania@
  const head = local.split(/[.\-_+0-9]/)[0];
  return head && ROLE_LOCALS.has(head) ? "role" : "personal";
}

/**
 * Full classification of an already cleaned email. `siteUrl` (or a bare
 * hostname) enables the `matchesSite` signal.
 */
export function analyzeEmail(email: string, siteUrl?: string): EmailInfo {
  const domain = email.slice(email.indexOf("@") + 1).toLowerCase();
  const info: EmailInfo = {
    email,
    kind: classifyEmail(email),
    domain,
    freeProvider: FREE_PROVIDERS.has(domain),
    disposable: domainMatches(domain, DISPOSABLE_DOMAINS),
  };
  if (siteUrl) {
    let host = siteUrl.toLowerCase();
    try {
      host = new URL(siteUrl.includes("://") ? siteUrl : `http://${siteUrl}`).hostname;
    } catch {
      /* use as-is */
    }
    host = host.replace(/^www\./, "");
    info.matchesSite = domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`);
  }
  return info;
}

// Each pattern is a single pass with small bounded quantifiers, so the
// replacement is linear in the text length.
const OBFUSCATED_AT = /\s{0,3}[\[({<]\s{0,3}(?:at|arroba)\s{0,3}[\])}>]\s{0,3}/gi;
const OBFUSCATED_DOT = /\s{0,3}[\[({<]\s{0,3}(?:dot|ponto)\s{0,3}[\])}>]\s{0,3}/gi;
const SPACED_AT = /(?<=\w)\s{1,3}@\s{1,3}(?=[A-Za-z0-9])/g;

/**
 * Undo the common anti-spam spellings: "contato [at] empresa [dot] com",
 * "vendas (arroba) loja (ponto) com (ponto) br", "nome @ empresa.com".
 * Plain words such as " at " are left alone — they are ordinary English.
 */
export function deobfuscate(text: string): string {
  return text.replace(OBFUSCATED_AT, "@").replace(OBFUSCATED_DOT, ".").replace(SPACED_AT, "@");
}

/**
 * Find valid emails in free text, including obfuscated spellings.
 */
export function findEmails(text: string): string[] {
  const candidates = text.match(EMAIL_REGEX) || [];
  const decoded = deobfuscate(text);
  const extra = decoded !== text ? decoded.match(EMAIL_REGEX) || [] : [];
  return cleanEmails([...candidates, ...extra]);
}

type MxResolver = (hostname: string) => Promise<{ exchange: string; priority: number }[]>;

const mxCache = new Map<string, { ok: boolean; expiresAt: number }>();
const DEFAULT_MX_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Whether the domain publishes MX records. Results are cached in memory for
 * `ttlMs`. Returns null when the lookup itself failed (timeout, no network),
 * so callers can tell "no mail server" apart from "could not check".
 * Not used by the default pipeline; opt in where DNS traffic is acceptable.
 */
export async function checkMx(
  domain: string,
  options: { ttlMs?: number; resolver?: MxResolver } = {}
): Promise<boolean | null> {
  const key = domain.trim().toLowerCase();
  if (!key) return false;
  const now = Date.now();
  const cached = mxCache.get(key);
  if (cached && cached.expiresAt > now) return cached.ok;

  // Lazy import: loading dns/promises eagerly breaks test-setup.ts's lookup-only mock.
  const resolver = options.resolver || (await import("node:dns/promises")).resolveMx;
  let ok: boolean;
  try {
    const records = await resolver(key);
    ok = records.some((r) => r.exchange && r.exchange !== ".");
  } catch (err: any) {
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA" || err?.code === "NXDOMAIN") {
      ok = false;
    } else {
      return null;
    }
  }
  mxCache.set(key, { ok, expiresAt: now + (options.ttlMs ?? DEFAULT_MX_TTL_MS) });
  return ok;
}

export function clearMxCache(): void {
  mxCache.clear();
}
