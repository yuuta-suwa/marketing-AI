import { describe, expect, it } from "vitest";
import { csvToManualItems, parseCsv } from "@/application/research/csv-import";
import { assertPublicUrl, fetchPageForImport, htmlToText, isPrivateAddress, robotsAllows } from "@/connectors/url-import";
import { enrichLocale, normalizeSourceItem } from "@/domain/source/normalize";
import { parseDirectiveByRules } from "@/domain/research/directive-parser";
import { sha256Hex } from "@/lib/hash";

describe("CSV import", () => {
  it("parses quoted fields, escaped quotes, CRLF and BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","he said ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
  });

  it("maps aliased columns and skips empty rows with counts", () => {
    const r = csvToManualItems("本文,出典,date,url\n移動が不便,アンケート,2026-09-01,https://ex.com\n,x,,\n予約が取れない,,bad-date,not-a-url\n", "file.csv");
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ body: "移動が不便", sourceName: "アンケート", url: "https://ex.com/", publishedAt: "2026-09-01T00:00:00.000Z" });
    expect(r.items[1]).toMatchObject({ sourceName: "file.csv", publishedAt: undefined, url: undefined });
    expect(r.skipped).toBe(1);
    expect(r.errors[0]).toContain("URL");
  });

  it("requires a body column", () => {
    expect(csvToManualItems("title\nx").errors[0]).toContain("本文列");
  });
});

describe("URL import safety", () => {
  it("detects private and loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("rejects SSRF targets and non-http schemes", async () => {
    const resolve = async () => ["10.0.0.5"];
    await expect(assertPublicUrl("http://internal.example.com/", resolve)).rejects.toThrow(/内部/);
    await expect(assertPublicUrl("http://localhost:3000/")).rejects.toThrow(/内部/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("http://user:pw@example.com/")).rejects.toThrow(/認証/);
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/内部/);
  });

  it("honors robots.txt (longest match, specific agent)", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: BadBot\nDisallow: /";
    expect(robotsAllows(robots, "/public")).toBe(true);
    expect(robotsAllows(robots, "/private/x")).toBe(false);
    expect(robotsAllows(robots, "/private/ok/page")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /", "/anything")).toBe(false);
    expect(robotsAllows("", "/x")).toBe(true);
  });

  it("extracts text from HTML without scripts", () => {
    const r = htmlToText("<html><head><title>T</title><script>evil()</script></head><body><p>空港&amp;駅</p><p>不便</p></body></html>");
    expect(r.title).toBe("T");
    expect(r.text).toContain("空港&駅");
    expect(r.text).not.toContain("evil");
  });

  it("fetches a page when allowed and refuses when robots disallow", async () => {
    const resolve = async () => ["93.184.216.34"];
    const ok = async (url: string) =>
      url.endsWith("/robots.txt")
        ? new Response("User-agent: *\nDisallow: /blocked", { status: 200 })
        : new Response("<title>Page</title><p>移動が不便だ</p>", { status: 200, headers: { "content-type": "text/html" } });
    const page = await fetchPageForImport("https://example.com/article", { fetch: ok, resolve });
    expect(page).toMatchObject({ title: "Page" });
    expect(page.text).toContain("移動が不便だ");
    await expect(fetchPageForImport("https://example.com/blocked/a", { fetch: ok, resolve })).rejects.toThrow(/robots/);
    const redirect = async (url: string) => (url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response("", { status: 302, headers: { location: "http://10.0.0.1/" } }));
    await expect(fetchPageForImport("https://example.com/r", { fetch: redirect, resolve })).rejects.toThrow(/リダイレクト/);
  });
});

describe("normalization locale enrichment", () => {
  const base = normalizeSourceItem(
    { sourceType: "WEB", sourceName: "x", body: "空港の移動が不便" },
    { researchRunId: "r", connectorId: "web_search", retrievedAt: "2026-10-01T00:00:00Z", complianceStatus: "APPROVED", hash: sha256Hex },
  );

  it("detects language and infers country only from a single-country directive (flagged)", () => {
    const e = enrichLocale(base, { countries: ["JP"] });
    expect(e).toMatchObject({ language: "ja", country: "JP" });
    expect(e.metadata).toMatchObject({ languageDetected: true, countryInferred: true });
    expect(enrichLocale(base, { countries: ["JP", "US"] }).country).toBeUndefined();
  });
});

describe("advanced directive overrides", () => {
  it("user-selected country, language and date range win over parsed values", () => {
    const d = parseDirectiveByRules({ input: "日本の旅行の不満", countries: ["US"], languages: ["en"], timeRangePreset: "30d" });
    expect(d.countries).toEqual(["US"]);
    expect(d.languages).toEqual(["en"]);
    expect(d.timeRange).toEqual({ preset: "30d" });
  });
});
