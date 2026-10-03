import type { RawSourceItem, NewSourceItem, SourceComplianceStatus } from "./source-item";

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^yclid$/i,
  /^mc_(cid|eid)$/i,
  /^ref(_src)?$/i,
  /^igshid$/i,
  /^si$/i,
  /^spm$/i,
];

/**
 * Canonical URL: lowercase scheme/host, no fragment, no tracking params,
 * sorted query, no trailing slash (except root), default ports removed.
 */
export function canonicalizeUrl(input: string | undefined): string | undefined {
  if (!input) return undefined;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
    url.port = "";
  }
  const kept = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.some((re) => re.test(k)))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  url.search = "";
  for (const [k, v] of kept) url.searchParams.append(k, v);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  const out = url.toString();
  return url.pathname === "/" && !url.search ? out.replace(/\/$/, "") : out;
}

/**
 * Text normalization used for hashing only (the stored body keeps the
 * original text so evidence quotes remain verbatim). Whitespace is dropped
 * entirely: insignificant in Japanese, negligible collision risk otherwise.
 */
export function normalizeForHash(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, "")
    .replace(/[!-/:-@[-`{-~、。・「」『』（）【】！？]/g, "");
}

/** Clean whitespace without altering words (stored body). */
export function cleanBody(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type Hasher = (input: string) => string;

export function normalizeSourceItem(
  raw: RawSourceItem,
  ctx: {
    researchRunId: string;
    connectorId: string;
    retrievedAt: string;
    complianceStatus: SourceComplianceStatus;
    hash: Hasher;
  },
): NewSourceItem {
  const body = cleanBody(raw.body);
  const title = raw.title ? cleanBody(raw.title) : undefined;
  return {
    researchRunId: ctx.researchRunId,
    connectorId: ctx.connectorId,
    sourceType: raw.sourceType,
    sourceName: raw.sourceName,
    sourceUrl: raw.sourceUrl,
    canonicalUrl: canonicalizeUrl(raw.sourceUrl),
    externalId: raw.externalId,
    title,
    body,
    language: raw.language,
    country: raw.country,
    publishedAt: raw.publishedAt,
    retrievedAt: ctx.retrievedAt,
    engagement: raw.engagement,
    metadata: raw.metadata,
    contentHash: ctx.hash(normalizeForHash(`${title ?? ""}\n${body}`)),
    complianceStatus: ctx.complianceStatus,
  };
}
