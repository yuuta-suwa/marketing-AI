import { describe, expect, it } from "vitest";
import { deduplicate } from "@/domain/source/dedup";
import { canonicalizeUrl, normalizeForHash, normalizeSourceItem } from "@/domain/source/normalize";
import { sha256Hex } from "@/lib/hash";

const ctx = { researchRunId: "r1", connectorId: "web_search", retrievedAt: "2026-10-01T00:00:00Z", complianceStatus: "APPROVED" as const, hash: sha256Hex };
const item = (over: Record<string, unknown>) =>
  normalizeSourceItem({ sourceType: "WEB", sourceName: "x", body: "本文", ...over } as never, ctx);

describe("canonical URL", () => {
  it("drops tracking params, fragments, www and default ports and sorts query", () => {
    expect(canonicalizeUrl("https://WWW.Example.com:443/a/?utm_source=x&b=2&a=1#frag")).toBe("https://example.com/a?a=1&b=2");
    expect(canonicalizeUrl("http://example.com/")).toBe("http://example.com");
    expect(canonicalizeUrl("javascript:alert(1)")).toBeUndefined();
    expect(canonicalizeUrl("not a url")).toBeUndefined();
  });
});

describe("normalization", () => {
  it("hash ignores whitespace, punctuation, width and case", () => {
    expect(normalizeForHash("空港、ホテル。 ＡＢＣ  def!")).toBe(normalizeForHash("空港ホテル abc def"));
  });

  it("keeps the original body (for verbatim evidence) and computes a 64-hex hash", () => {
    const n = item({ body: "  空港から\r\nホテル  " });
    expect(n.body).toBe("空港から\nホテル");
    expect(n.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("deduplication", () => {
  it("dedups by external id within a connector", () => {
    const r = deduplicate([item({ externalId: "1", body: "a" }), item({ externalId: "1", body: "b" })]);
    expect(r.unique).toHaveLength(1);
    expect(r.duplicates[0].reason).toBe("external_id");
  });

  it("dedups by content hash", () => {
    const r = deduplicate([item({ body: "同じ 内容" }), item({ body: "同じ内容。" })]);
    expect(r.unique).toHaveLength(1);
    expect(r.duplicates[0].reason).toBe("content_hash");
  });

  it("dedups by canonical url only for items without external ids", () => {
    const r1 = deduplicate([
      item({ sourceUrl: "https://a.com/p?utm_source=x", body: "one" }),
      item({ sourceUrl: "https://a.com/p", body: "two" }),
    ]);
    expect(r1.unique).toHaveLength(1);
    expect(r1.duplicates[0].reason).toBe("canonical_url");

    const reviews = deduplicate([
      item({ sourceUrl: "https://maps.example/p", externalId: "rev1", body: "one" }),
      item({ sourceUrl: "https://maps.example/p", externalId: "rev2", body: "two" }),
    ]);
    expect(reviews.unique).toHaveLength(2);
  });

  it("dedups against items already stored", () => {
    const existing = [item({ body: "既存" })];
    expect(deduplicate([item({ body: "既存" })], { existing }).unique).toHaveLength(0);
  });

  it("supports an optional semantic comparator", () => {
    const r = deduplicate([item({ body: "aaa" }), item({ body: "aab" })], { isSemanticDuplicate: () => true });
    expect(r.duplicates[0].reason).toBe("semantic");
  });
});
