import { fetchRawHtml, processHtmlToMarkdown, type LinkFormat, type ImageMode } from "./extractor.js";
import { getCachedPage, setCachedPage, buildCacheKey } from "./cache.js";
import { validateTargetUrl } from "./security.js";
import { extractContacts } from "./contacts.js";
import type { GoogleMapsLead } from "./maps-bridge.js";
import { countryToRegion, findPhones, normalizePhone } from "./quality/phone.js";
import { cleanEmails, findEmails } from "./quality/email.js";
import { formatCnpj } from "./quality/cnpj.js";

export interface EnrichedLeadResult {
  title: string;
  category?: string;
  address?: string;
  phone?: string;
  whatsapp?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  latitude?: number;
  longitude?: number;

  // Enriched fields
  emails: string[];
  socialLinks: {
    instagram?: string;
    linkedin?: string;
    facebook?: string;
    youtube?: string;
    twitter?: string;
  };
  additionalPhones: string[];
  decisionMakers: string[];
  markdownSummary: string;
  estimatedTokens: number;
  enrichedFromUrl?: string;
  sourcePagesCrawled: string[];
  enrichmentSuccess: boolean;
  error?: string;

  // Normalized details
  /** DV-valid CNPJs printed on the company site, unmasked. */
  cnpjFromSite?: string[];
}

type EnrichOptions = {
  mode?: "fast" | "deep";
  crawlContactPages?: boolean;
  linkFormat?: LinkFormat;
  imageMode?: ImageMode;
};

/**
 * Fetch the raw home HTML once. Fast mode escalates to the browser when the
 * plain fetch is stopped by an anti-bot page, mirroring extractFast.
 */
async function fetchHomeHtml(url: string, mode: "fast" | "deep"): Promise<string> {
  try {
    return await fetchRawHtml(url, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (mode === "fast" && /Anti-Bot protection|cloudflare|just a moment/i.test(message)) {
      return fetchRawHtml(url, "deep", { maxRetries: 2 });
    }
    throw error;
  }
}

function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * Deeply enrich a company or Google Maps lead using LookaCrawler's token-optimized engine.
 *
 * The home page is fetched once: the same raw HTML feeds contact extraction
 * (which needs <nav>/<footer>) and, on a cache miss, the markdown summary.
 */
export async function deepEnrichLead(
  lead: Partial<GoogleMapsLead> & { title: string; web_site?: string },
  options: EnrichOptions = {}
): Promise<EnrichedLeadResult> {
  const mode = options.mode || "fast";
  const linkFormat = options.linkFormat || "references";
  const imageMode = options.imageMode || "alt_only";
  const crawlContactPages = options.crawlContactPages !== false;

  const result: EnrichedLeadResult = {
    title: lead.title,
    category: lead.category,
    address: lead.address,
    phone: lead.phone,
    whatsapp: lead.whatsapp_link,
    website: lead.web_site,
    rating: lead.review_rating,
    reviews: lead.review_count,
    latitude: lead.latitude,
    longitude: lead.longitude,
    // Maps emails go through the same cleaning as site emails (lowercase,
    // placeholders, asset names) so "Contato@X.com" and "contato@x.com" merge.
    emails: cleanEmails(lead.emails || []),
    socialLinks: {},
    additionalPhones: [],
    decisionMakers: [],
    markdownSummary: "",
    estimatedTokens: 0,
    sourcePagesCrawled: [],
    enrichmentSuccess: false,
    cnpjFromSite: [],
  };

  // The structured country from Maps decides how national numbers are read.
  const region = countryToRegion(lead.complete_address?.country) || "BR";

  // Phones are deduplicated by E.164, starting with the Maps listing phone.
  const phoneKeys = new Set<string>();
  const addPhone = (e164: string, formatted: string) => {
    if (phoneKeys.has(e164)) return;
    phoneKeys.add(e164);
    result.additionalPhones.push(formatted);
  };

  if (lead.phone) {
    const main = normalizePhone(lead.phone, { defaultRegion: region, context: "maps" });
    if (main && main.valid) phoneKeys.add(main.e164);
  }

  const addEmails = (emails: Iterable<string>) => {
    for (const em of cleanEmails(emails)) if (!result.emails.includes(em)) result.emails.push(em);
  };

  if (!lead.web_site || !lead.web_site.startsWith("http")) {
    result.error = "Lead has no valid website to enrich.";
    return result;
  }

  try {
    await validateTargetUrl(lead.web_site);
  } catch (secErr: any) {
    result.error = `Website blocked by security policy: ${secErr?.message}`;
    return result;
  }

  try {
    // 1. Fetch the home page once. The markdown cache only saves the
    //    Readability/Turndown pass: contacts need the raw html either way.
    const cacheKey = buildCacheKey({
      url: lead.web_site,
      mode,
      linkFormat,
      imageMode,
    });
    let homeMarkdown = getCachedPage(cacheKey);

    // Raw html feeds contact extraction (and the markdown on a cache miss).
    // On a deep-mode cache hit skip the browser: extractContacts fetches the
    // home page itself with a plain request.
    let rawHtml: string | undefined;
    if (!homeMarkdown || mode === "fast") {
      try {
        rawHtml = await fetchHomeHtml(lead.web_site, mode);
      } catch (fetchErr) {
        // With cached markdown we can still summarize; without it there is nothing to enrich.
        if (!homeMarkdown) throw fetchErr;
      }
    }

    if (!homeMarkdown && rawHtml !== undefined) {
      homeMarkdown = processHtmlToMarkdown(rawHtml, { url: lead.web_site, linkFormat, imageMode });
      setCachedPage(cacheKey, homeMarkdown);
    }
    homeMarkdown = homeMarkdown || "";

    result.sourcePagesCrawled.push(lead.web_site);
    result.enrichedFromUrl = lead.web_site;

    // 2. Contacts from the RAW html, not from `homeMarkdown`: the markdown
    //    pipeline strips <nav>/<footer> as boilerplate, which is exactly where
    //    most companies put the contact email, phones, CNPJ and social links.
    let contacts: Awaited<ReturnType<typeof extractContacts>> | null = null;
    try {
      contacts = await extractContacts({
        url: lead.web_site,
        html: rawHtml,
        deepScan: crawlContactPages,
        defaultRegion: region,
      });
    } catch {
      /* contact extraction is best-effort; markdown fallbacks below still run */
    }

    if (contacts) {
      addEmails(contacts.emails);
      const { instagram, linkedin, facebook, youtube, twitter } = contacts.socials;
      result.socialLinks.instagram = instagram;
      result.socialLinks.linkedin = linkedin;
      result.socialLinks.facebook = facebook;
      result.socialLinks.youtube = youtube;
      result.socialLinks.twitter = twitter;
      for (const p of contacts.phoneDetails || []) addPhone(p.e164, p.formatted);
      for (const page of contacts.contactPagesScanned) {
        if (!result.sourcePagesCrawled.includes(page)) result.sourcePagesCrawled.push(page);
      }
      if (!result.whatsapp && contacts.whatsapps.length > 0) {
        result.whatsapp = `https://wa.me/${contacts.whatsapps[0]}`;
      }
      result.cnpjFromSite = contacts.cnpjs || [];
    }

    // 3. Markdown scan as a fallback for pages whose contact data survived
    //    pruning, or when only the cached markdown is available.
    addEmails(findEmails(homeMarkdown));

    // 4. Extract social links
    const socialMatches = homeMarkdown.match(/https?:\/\/(?:www\.)?(instagram|linkedin|facebook|youtube|twitter|x)\.com\/[a-zA-Z0-9._-]+/gi) || [];
    for (const sm of socialMatches) {
      const lower = sm.toLowerCase();
      if (lower.includes("instagram.com") && !result.socialLinks.instagram) {
        result.socialLinks.instagram = sm;
      } else if (lower.includes("linkedin.com") && !result.socialLinks.linkedin) {
        result.socialLinks.linkedin = sm;
      } else if (lower.includes("facebook.com") && !result.socialLinks.facebook) {
        result.socialLinks.facebook = sm;
      } else if (lower.includes("youtube.com") && !result.socialLinks.youtube) {
        result.socialLinks.youtube = sm;
      } else if ((lower.includes("twitter.com") || lower.includes("x.com")) && !result.socialLinks.twitter) {
        result.socialLinks.twitter = sm;
      }
    }

    // 5. Phones still in the markdown, deduplicated by E.164 against Maps and
    //    the html scan. The phone module rejects CPF/CNPJ/CEP/ids.
    for (const p of findPhones(homeMarkdown, { defaultRegion: region })) {
      addPhone(p.e164, p.country === region ? p.national : p.international);
    }

    // 6. Contact page fallback, only when extractContacts could not run its
    //    own subpage scan (it already visits /contato, /fale-conosco, ...).
    if (crawlContactPages && !contacts && result.emails.length === 0) {
      const contactUrlMatch = homeMarkdown.match(/https?:\/\/[^\s\)\"\'\]]+(?:contact|contato|fale-conosco|about|quem-somos)[^\s\)\"\'\]]*/i);
      const contactUrl = contactUrlMatch?.[0];
      if (contactUrl && contactUrl !== lead.web_site && !result.sourcePagesCrawled.includes(contactUrl)) {
        try {
          await validateTargetUrl(contactUrl);
          const contactHtml = await fetchRawHtml(contactUrl, "fast", { maxRetries: 1 });
          result.sourcePagesCrawled.push(contactUrl);
          const contactMd = processHtmlToMarkdown(contactHtml, { url: contactUrl, linkFormat, imageMode });
          addEmails(findEmails(contactMd));
        } catch {
          /* non-critical contact page crawl failure */
        }
      }
    }

    // 7. Extract possible decision makers / doctors / owners
    const personRegex = /(?:Dr\.|Dra\.|Diretor|Fundador|Sócio|CEO|Proprietário|Cirurgião|Owner|Founder|Director)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/g;
    let match;
    while ((match = personRegex.exec(homeMarkdown)) !== null) {
      if (match[1] && !result.decisionMakers.includes(match[1])) {
        result.decisionMakers.push(match[1].trim());
      }
    }

    // 8. Build ultra-compact LLM summary (< 300 tokens)
    const summaryLines: string[] = [
      `### ${result.title}`,
      `- **Categoria/Nicho:** ${result.category || "Não informado"}`,
      `- **Localização:** ${result.address || "Não informada"}`,
      result.phone ? `- **Telefone Comercial:** ${result.phone}` : "",
      result.whatsapp ? `- **WhatsApp:** ${result.whatsapp}` : "",
      result.emails.length > 0 ? `- **E-mails Encontrados:** ${result.emails.join(", ")}` : "",
      result.cnpjFromSite && result.cnpjFromSite.length > 0
        ? `- **CNPJ (site):** ${result.cnpjFromSite.map(formatCnpj).join(", ")}`
        : "",
      result.decisionMakers.length > 0 ? `- **Responsáveis/Corpo Técnico:** ${result.decisionMakers.join(", ")}` : "",
      result.socialLinks.instagram ? `- **Instagram:** ${result.socialLinks.instagram}` : "",
      result.socialLinks.linkedin ? `- **LinkedIn:** ${result.socialLinks.linkedin}` : "",
      result.socialLinks.twitter ? `- **Twitter/X:** ${result.socialLinks.twitter}` : "",
      `\n**Resumo do Conteúdo Web:**`,
      homeMarkdown.slice(0, 1000).replace(/\n{2,}/g, "\n").trim(),
    ].filter(Boolean);

    result.markdownSummary = summaryLines.join("\n");
    result.estimatedTokens = Math.ceil(result.markdownSummary.length / 4);
    result.enrichmentSuccess = true;
  } catch (err: any) {
    result.error = `Failed to enrich lead via LookaCrawler: ${err?.message}`;
  }

  return result;
}
