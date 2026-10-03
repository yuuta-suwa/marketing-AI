import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { FetchLike } from "./http";

/**
 * Fetches a single user-supplied page for Manual Import.
 * Safeguards: http(s) only, no credentials in URL, private/loopback/link-local
 * addresses rejected (SSRF), robots.txt honored for our user agent, no
 * redirects followed to other hosts, 2 MB / 15 s limits, HTML → text.
 */
export const URL_IMPORT_USER_AGENT = "MarketRadarOS-ManualImport/0.1 (+user-initiated single page import)";

export class UrlImportError extends Error {}

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

export async function assertPublicUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlImportError("URLが不正です");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UrlImportError("http/https のみ対応しています");
  if (url.username || url.password) throw new UrlImportError("認証情報付きURLは使用できません");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new UrlImportError("内部ホストは取得できません");
  const addresses = isIP(host) ? [host] : await resolve(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new UrlImportError("内部ネットワークのアドレスは取得できません");
  return url;
}

/** Minimal robots.txt evaluation for `User-agent: *` and our agent (longest-match Allow/Disallow). */
export function robotsAllows(robotsTxt: string, path: string, agent = "marketradaros"): boolean {
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-zA-Z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of chosen.flatMap((g) => g.rules)) {
    const pattern = new RegExp(`^${rule.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
    if (pattern.test(path) && (!best || rule.path.length > best.len || (rule.path.length === best.len && rule.allow))) {
      best = { allow: rule.allow, len: rule.path.length };
    }
  }
  return best ? best.allow : true;
}

export function htmlToText(html: string): { title?: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const text = html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return { title: title?.replace(/\s+/g, " ").trim(), text };
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UrlImportError("ページが大きすぎます（2MB上限）");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchPageForImport(
  rawUrl: string,
  deps: { fetch?: FetchLike; resolve?: Resolver; timeoutMs?: number } = {},
): Promise<{ url: string; title?: string; text: string }> {
  const f = deps.fetch ?? ((u, i) => fetch(u, i));
  const url = await assertPublicUrl(rawUrl, deps.resolve);
  const timeout = deps.timeoutMs ?? 15_000;
  const headers = { "User-Agent": URL_IMPORT_USER_AGENT, Accept: "text/html,text/plain;q=0.9" };

  const robots = await f(`${url.origin}/robots.txt`, { headers, redirect: "manual", signal: AbortSignal.timeout(timeout) }).catch(() => null);
  if (robots && robots.ok && !robotsAllows(await readLimited(robots, 512_000), url.pathname + url.search)) {
    throw new UrlImportError("robots.txt により取得が許可されていません");
  }
  const res = await f(url.toString(), { headers, redirect: "manual", signal: AbortSignal.timeout(timeout) });
  if (res.status >= 300 && res.status < 400) throw new UrlImportError("リダイレクト先は取得しません（最終URLを指定してください）");
  if (!res.ok) throw new UrlImportError(`取得できませんでした（HTTP ${res.status}）`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain/.test(type)) throw new UrlImportError("HTML/テキスト以外は取り込みできません");
  const body = await readLimited(res, 2_000_000);
  const { title, text } = type.includes("html") ? htmlToText(body) : { title: undefined, text: body.trim() };
  if (!text) throw new UrlImportError("本文が空です");
  return { url: url.toString(), title, text: text.slice(0, 100_000) };
}
