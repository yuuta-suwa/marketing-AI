import { describe, expect, it } from "vitest";
import { parseDirectiveByRules } from "@/domain/research/directive-parser";
import { ResearchDirectiveSchema } from "@/domain/research/directive";
import { clusterSignals, computeMomentum, type ClusterableSignal } from "@/domain/cluster/cluster";
import { LocalHashEmbeddingProvider } from "@/infrastructure/ai/local-hash-embeddings";

describe("research directive", () => {
  it("structures a Japanese request deterministically", () => {
    const d = parseDirectiveByRules({ input: "日本の旅行市場で、利用者が困っていることから新規事業を探して" });
    expect(d.countries).toEqual(["JP"]);
    expect(d.languages).toEqual(["ja"]);
    expect(d.categories).toContain("travel");
    expect(d.personas).toContain("end users");
    expect(d.keywords.length).toBeGreaterThan(0);
    expect(d.maxItems).toBe(50);
    expect(ResearchDirectiveSchema.safeParse(d).success).toBe(true);
  });

  it("respects user-provided limits", () => {
    const d = parseDirectiveByRules({ input: "Find pains of US freelancers with invoicing", maxItems: 10, budgetLimitUsd: 0.1, deepResearch: true });
    expect(d.countries).toEqual(["US"]);
    expect(d.languages).toEqual(["en"]);
    expect(d.maxItems).toBe(10);
    expect(d.budgetLimitUsd).toBe(0.1);
    expect(d.deepResearch).toBe(true);
  });

  it("rejects invalid structured output", () => {
    expect(ResearchDirectiveSchema.safeParse({ rawInput: "x", objective: "x", countries: ["japan"] }).success).toBe(false);
    expect(ResearchDirectiveSchema.safeParse({ rawInput: "x", objective: "x", maxItems: 100000 }).success).toBe(false);
  });
});

describe("clustering", () => {
  it("groups lexically similar signals and separates different topics", async () => {
    const texts = [
      "空港からホテルまでの移動が分かりにくい",
      "空港から市内への移動が分かりにくい",
      "空港の移動案内が分かりにくい",
      "駅のコインロッカーが足りない",
      "コインロッカーが足りない、いつも満杯",
    ];
    const { vectors } = await new LocalHashEmbeddingProvider().embed(texts);
    const signals: ClusterableSignal[] = texts.map((t, i) => ({
      id: `s${i}`,
      signalType: i < 3 ? "INFORMATION_GAP" : "SHORTAGE",
      embedding: vectors[i],
      urgencyScore: 50,
      willingnessToPayScore: 10,
      confidence: "LOW",
      sourceKeys: [`src${i % 2}`],
      countries: ["JP"],
      languages: ["ja"],
      observedAt: ["2026-09-20T00:00:00Z"],
    }));
    const clusters = clusterSignals(signals, { threshold: 0.35, now: "2026-10-01T00:00:00Z" });
    expect(clusters).toHaveLength(2);
    expect(clusters[0].signalIds.sort()).toEqual(["s0", "s1", "s2"]);
    expect(clusters[1].dominantType).toBe("SHORTAGE");
    expect(clusters[0].sourceCount).toBe(2);
  });

  it("momentum is 0 without history and positive when recent observations dominate", () => {
    expect(computeMomentum([])).toBe(0);
    const now = "2026-10-01T00:00:00Z";
    expect(computeMomentum(["2026-09-25T00:00:00Z", "2026-09-26T00:00:00Z", "2026-08-20T00:00:00Z"], now)).toBeGreaterThan(0);
  });
});
