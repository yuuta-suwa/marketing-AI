"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { enforceRateLimit } from "@/application/rate-limit";
import { compareOpportunityBusinessModels, runCfoAnalysis } from "@/application/analysis/business-model";
import { addManualCompetitor, analyzeCompetitors } from "@/application/analysis/competitors";
import { advanceExperiment, createExperiment } from "@/application/analysis/experiments";
import { estimateOpportunityMarket } from "@/application/analysis/market-size";
import { updateScoringWeights } from "@/application/settings/scoring";
import { CfoInputSchema, type InputProvenance } from "@/domain/analysis/cfo";
import { EXPERIMENT_DECISIONS } from "@/domain/analysis/experiment";
import { METHOD_INPUTS, type MarketInput } from "@/domain/analysis/market-size";
import { MARKET_SIZE_METHODS } from "@/domain/opportunity/business-model";
import { SCORE_CRITERIA, type ScoringWeights } from "@/domain/scoring/criteria";
import { buildAppContext, requireSession } from "@/infrastructure/server-context";
import { toActionError, type ActionState } from "./result";

const Id = z.uuid();
/** Session context with the per-user analysis rate limit applied. */
const ctxOf = async () => {
  const ctx = buildAppContext(await requireSession());
  await enforceRateLimit(ctx, "analysis.run");
  return ctx;
};
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  return v === undefined ? undefined : Number(v);
};
const done = (opportunityId: string, message: string): ActionState => {
  revalidatePath(`/opportunities/${opportunityId}`);
  return { ok: true, message };
};

export async function analyzeCompetitorsAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const id = Id.parse(f.get("opportunityId"));
    const rows = await analyzeCompetitors(await ctxOf(), id);
    return done(id, `競合・代替手段 ${rows.length}件`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function addCompetitorAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const id = Id.parse(f.get("opportunityId"));
    const input = z
      .object({
        name: z.string().min(1).max(120),
        competitorType: z.enum(["DIRECT", "INDIRECT", "ALTERNATIVE"]),
        url: z.url().optional(),
        pricing: z.string().max(500).optional(),
        positioning: z.string().max(500).optional(),
        weaknesses: z.string().max(500).optional(),
        evidenceId: z.uuid().optional(),
      })
      .parse({ name: str(f, "name"), competitorType: str(f, "competitorType"), url: str(f, "url"), pricing: str(f, "pricing"), positioning: str(f, "positioning"), weaknesses: str(f, "weaknesses"), evidenceId: str(f, "evidenceId") });
    await addManualCompetitor(await ctxOf(), id, input);
    return done(id, `競合「${input.name}」を追加しました`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function marketSizeAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const id = Id.parse(f.get("opportunityId"));
    const method = z.enum(MARKET_SIZE_METHODS).parse(f.get("method"));
    const inputs: Record<string, MarketInput> = {};
    for (const { key, unit } of METHOD_INPUTS[method]) {
      const value = num(f, `${key}.value`);
      if (value === undefined || Number.isNaN(value)) continue;
      const evidenceId = str(f, `${key}.evidenceId`);
      inputs[key] = { value, unit, epistemic: evidenceId ? "FACT" : "ASSUMPTION", evidenceId, note: str(f, `${key}.note`) };
    }
    const est = await estimateOpportunityMarket(await ctxOf(), {
      opportunityId: id,
      method,
      inputs,
      currency: z.string().regex(/^[A-Za-z]{3}$/).parse(str(f, "currency") ?? "JPY"),
      notes: str(f, "notes"),
    });
    return done(id, `市場規模: ${est.resultValue.toLocaleString()} ${est.currency}/年（${est.confidence}）`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function businessModelAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const id = Id.parse(f.get("opportunityId"));
    const models = await compareOpportunityBusinessModels(await ctxOf(), id);
    return done(id, `${models.length}モデルを比較しました`);
  } catch (e) {
    return toActionError(e);
  }
}

const CFO_FIELDS = ["pricePerMonth", "variableCostPerCustomerMonth", "aiCostPerCustomerMonth", "apiCostPerCustomerMonth", "cac", "monthlyChurn", "fixedCostPerMonth"] as const;

export async function cfoAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const id = Id.parse(f.get("opportunityId"));
    const inputs: Record<string, unknown> = {};
    const provenance: InputProvenance = {};
    for (const k of CFO_FIELDS) {
      const v = num(f, k);
      if (v !== undefined && !Number.isNaN(v)) inputs[k] = v;
      const evidenceId = str(f, `${k}.evidenceId`);
      if (v !== undefined) provenance[k] = { epistemic: evidenceId ? "FACT" : "ASSUMPTION", evidenceId };
    }
    const c = num(f, "customers.conservative");
    const b = num(f, "customers.base");
    const o = num(f, "customers.optimistic");
    if (c !== undefined && b !== undefined && o !== undefined) inputs.customersScenario = { conservative: c, base: b, optimistic: o };
    const partial = CfoInputSchema.partial().parse(inputs);
    const { analysis } = await runCfoAnalysis(await ctxOf(), { opportunityId: id, inputs: partial, provenance, currency: str(f, "currency") });
    return done(id, `CFO分析を更新（警告 ${analysis.warnings.length}件）`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function createExperimentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const id = Id.parse(f.get("opportunityId"));
    await createExperiment(await ctxOf(), id, {
      title: str(f, "title") ?? "",
      hypothesis: str(f, "hypothesis") ?? "",
      method: str(f, "method") ?? "",
      metric: str(f, "metric") ?? "",
      target: str(f, "target") ?? "",
      budgetUsd: num(f, "budgetUsd") ?? 0,
      deadline: str(f, "deadline") ?? "",
      killCriteria: str(f, "killCriteria"),
    });
    return done(id, "実験を作成しました（PROPOSED）");
  } catch (e) {
    return toActionError(e);
  }
}

export async function advanceExperimentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const opportunityId = Id.parse(f.get("opportunityId"));
    const experimentId = Id.parse(f.get("experimentId"));
    const type = z.enum(["approve", "start", "cancel", "complete"]).parse(f.get("op"));
    const action =
      type === "complete"
        ? { type, resultSummary: z.string().trim().min(1, "結果を入力してください").max(4000).parse(str(f, "resultSummary") ?? ""), decision: z.enum(EXPERIMENT_DECISIONS).parse(f.get("decision")) }
        : { type };
    const exp = await advanceExperiment(await ctxOf(), experimentId, action);
    return done(opportunityId, `実験: ${exp.status}`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function scoringWeightsAction(_p: ActionState, f: FormData): Promise<ActionState> {
  try {
    const weights = Object.fromEntries(SCORE_CRITERIA.map((c) => [c, Number(f.get(c) ?? 0)])) as ScoringWeights;
    await updateScoringWeights(await ctxOf(), weights);
    revalidatePath("/settings/scoring");
    return { ok: true, message: "重みを保存しました（以降の採点に適用）" };
  } catch (e) {
    return toActionError(e);
  }
}
