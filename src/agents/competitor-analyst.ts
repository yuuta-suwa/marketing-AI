import { z } from "zod";
import type { AIProvider, GenerateResult } from "@/domain/agent/ai-provider";
import { validateEvidenceRefs, type Evidence } from "@/domain/evidence/evidence";
import type { StoredSignal } from "@/domain/signal/signal";

export const COMPETITOR_ANALYST = "CompetitorAnalystAgent";

export type CompetitorFinding = {
  name: string;
  competitorType: "DIRECT" | "INDIRECT" | "ALTERNATIVE";
  pricing?: string;
  positioning?: string;
  customerComplaints?: string;
  strengths?: string;
  weaknesses?: string;
  marketGap?: string;
  epistemicStatus: "FACT" | "INFERENCE";
  sourceEvidenceIds: string[];
};

const NAMED = /([A-Za-z][\w.&-]{2,30}|[ァ-ヶー]{3,15})(?:を使|で予約|に乗り換|から乗り換|のアプリ|のサービス|を利用)/g;
const GENERIC_ALTERNATIVES: Array<[RegExp, string]> = [
  [/タクシー|taxi/i, "タクシー"],
  [/エクセル|excel|スプレッドシート|spreadsheet/i, "表計算ソフトでの手作業"],
  [/カフェ/i, "カフェ等での代替"],
  [/予約サイト|ota|booking site/i, "既存の予約サイト"],
  [/電話/i, "電話での問い合わせ"],
  [/他社|別のサービス|another service/i, "他社サービス"],
  [/自分で|手作業|manually/i, "自力対応（手作業）"],
];

/**
 * Deterministic competitor/alternative extraction. Only names that appear in
 * evidence text are used; every finding cites its evidence.
 */
export function analyzeCompetitorsHeuristically(signals: readonly StoredSignal[], evidence: readonly Evidence[]): CompetitorFinding[] {
  const byName = new Map<string, CompetitorFinding>();
  const add = (name: string, type: CompetitorFinding["competitorType"], e: Evidence, s?: StoredSignal) => {
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      if (!existing.sourceEvidenceIds.includes(e.id)) existing.sourceEvidenceIds.push(e.id);
      return;
    }
    byName.set(key, {
      name,
      competitorType: type,
      customerComplaints: e.evidenceText.slice(0, 300),
      weaknesses: s?.signalType === "SWITCHING" ? "顧客の乗換が発生している" : s?.signalType === "WORKAROUND" ? "顧客は不満を抱えつつ代替として使っている" : undefined,
      marketGap: s ? `この代替手段では「${s.problem.slice(0, 60)}」が解消されていない` : undefined,
      epistemicStatus: "INFERENCE",
      sourceEvidenceIds: [e.id],
    });
  };
  const signalByEvidence = new Map<string, StoredSignal>();
  for (const s of signals) for (const id of s.evidenceIds) signalByEvidence.set(id, s);
  for (const e of evidence) {
    const s = signalByEvidence.get(e.id);
    const generic = new Set<string>();
    if (s && (s.signalType === "WORKAROUND" || s.signalType === "SWITCHING" || s.priceIssue)) {
      for (const [re, label] of GENERIC_ALTERNATIVES) {
        if (re.test(e.evidenceText)) {
          add(label, "ALTERNATIVE", e, s);
          generic.add(label);
        }
      }
    }
    for (const m of e.evidenceText.matchAll(NAMED)) {
      if (!generic.has(m[1])) add(m[1], s?.signalType === "SWITCHING" ? "DIRECT" : "INDIRECT", e, s);
    }
  }
  return [...byName.values()].slice(0, 20);
}

const OutputSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string().min(1).max(120),
      competitorType: z.enum(["DIRECT", "INDIRECT", "ALTERNATIVE"]),
      pricing: z.string().max(500).optional(),
      positioning: z.string().max(500).optional(),
      customerComplaints: z.string().max(1000).optional(),
      strengths: z.string().max(500).optional(),
      weaknesses: z.string().max(500).optional(),
      marketGap: z.string().max(500).optional(),
      evidenceIds: z.array(z.string()).min(1),
    }),
  ).max(20),
});

const SYSTEM = `You are CompetitorAnalystAgent of MARKET RADAR OS.
List existing competitors, indirect alternatives and workarounds for the opportunity, using ONLY the evidence given.
Hard rules: a competitor name must appear in the cited evidence text; never invent companies, prices or market shares.
Cite evidence ids only from the list. Write in Japanese. Respond with JSON only.`;

export async function analyzeCompetitorsWithLLM(
  provider: AIProvider,
  opportunity: { title: string; pain: string },
  evidence: readonly Evidence[],
): Promise<{ findings: CompetitorFinding[]; llm: Omit<GenerateResult<unknown>, "output"> }> {
  const res = await provider.generate({
    agent: COMPETITOR_ANALYST,
    system: SYSTEM,
    prompt: JSON.stringify({ opportunity, evidence: evidence.map((e) => ({ id: e.id, text: e.evidenceText })) }),
    schema: OutputSchema,
    maxOutputTokens: 3000,
  });
  const known = new Set(evidence.map((e) => e.id));
  const text = new Map(evidence.map((e) => [e.id, e.evidenceText]));
  const findings: CompetitorFinding[] = [];
  for (const c of res.output.competitors) {
    const { valid, invalid } = validateEvidenceRefs(c.evidenceIds, known);
    if (invalid.length > 0 || valid.length === 0) continue;
    // Name must literally appear in at least one cited excerpt (no invented companies).
    const mentioned = valid.some((id) => text.get(id)?.toLowerCase().includes(c.name.toLowerCase()));
    findings.push({ ...c, sourceEvidenceIds: valid, epistemicStatus: mentioned ? "FACT" : "INFERENCE", competitorType: mentioned ? c.competitorType : "ALTERNATIVE" });
  }
  return { findings, llm: { usage: res.usage, costUsd: res.costUsd, provider: res.provider, model: res.model } };
}
