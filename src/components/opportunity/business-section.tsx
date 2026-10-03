"use client";
import { businessModelAction, cfoAction } from "@/app/actions/analysis";
import type { StoredBusinessModel } from "@/application/ports/repositories";
import { BUSINESS_MODEL_LABEL_JA } from "@/domain/analysis/business-model";
import { EpistemicTag } from "../badges";
import { ActionForm } from "../forms/action-form";
import { SubmitButton } from "../submit-button";

const field = "min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm";

const CFO_INPUTS = [
  ["pricePerMonth", "販売価格（月額/顧客）"],
  ["variableCostPerCustomerMonth", "変動費（月/顧客）"],
  ["aiCostPerCustomerMonth", "AIコスト（月/顧客）"],
  ["apiCostPerCustomerMonth", "APIコスト（月/顧客）"],
  ["cac", "CAC"],
  ["monthlyChurn", "月次解約率（0-1）"],
  ["fixedCostPerMonth", "固定費（月）"],
] as const;

const METRIC_LABEL: Record<string, string> = {
  grossMargin: "粗利率", ltv: "LTV", ltvToCac: "LTV/CAC", paybackMonths: "回収期間（月）", breakEvenCustomers: "損益分岐顧客数",
  monthlyRevenue_conservative: "月次売上（保守）", monthlyRevenue_base: "月次売上（基本）", monthlyRevenue_optimistic: "月次売上（楽観）",
  annualRevenue_conservative: "年間売上（保守）", annualRevenue_base: "年間売上（基本）", annualRevenue_optimistic: "年間売上（楽観）",
};

export function BusinessModelSection({ opportunityId, models, evidenceOptions }: { opportunityId: string; models: StoredBusinessModel[]; evidenceOptions: Array<{ id: string; label: string }> }) {
  const primary = models.find((m) => m.isPrimary);
  const ue = primary?.unitEconomics;
  return (
    <div className="space-y-3" data-testid="business-models">
      {models.length === 0 ? <p className="text-sm text-muted">未比較</p> : (
        <ol className="space-y-1 text-sm">
          {models.map((m) => (
            <li key={m.id} className={`rounded-xl border p-2 ${m.isPrimary ? "border-accent" : "border-line"}`}>
              <div className="flex justify-between gap-2"><span className="font-semibold">{BUSINESS_MODEL_LABEL_JA[m.modelType]}{m.isPrimary ? "（第一候補）" : ""}</span><span className="text-xs">適合 {m.fitScore} <EpistemicTag status="HYPOTHESIS" /></span></div>
              <p className="text-xs text-muted">{m.rationale} · リスク: {m.risks}</p>
            </li>
          ))}
        </ol>
      )}
      <ActionForm action={businessModelAction}>
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <SubmitButton variant="secondary" pendingLabel="比較中…">収益モデルを比較（11種）</SubmitButton>
      </ActionForm>

      <div data-testid="cfo">
        <p className="mb-1 text-xs font-semibold text-muted">CFO分析 {primary ? `— ${BUSINESS_MODEL_LABEL_JA[primary.modelType]}` : ""}</p>
        {ue?.metrics ? (
          <>
            <table className="w-full text-xs">
              <tbody>
                {Object.entries(ue.metrics)
                  .filter(([k]) => METRIC_LABEL[k] || ["sellingPrice", "cac", "monthlyChurn"].includes(k))
                  .map(([k, m]) => (
                    <tr key={k} className="border-b border-line">
                      <td className="py-1">{METRIC_LABEL[k] ?? k}</td>
                      <td className="py-1 text-right font-mono">{Number.isFinite(m.value) ? (m.unit === "ratio" ? `${Math.round(m.value * 1000) / 10}%` : m.value.toLocaleString()) : "∞"}</td>
                      <td className="py-1 pl-2 text-right"><EpistemicTag status={m.epistemic} /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {ue.warnings?.length ? <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">{ue.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
          </>
        ) : <p className="text-sm text-muted">未計算（初期値は業態別の仮定値。数値を入力すると上書きされます）</p>}
        <details className="mt-2 rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">前提を入力してCFO分析</summary>
          <ActionForm action={cfoAction} className="mt-2 space-y-2">
            <input type="hidden" name="opportunityId" value={opportunityId} />
            <input name="currency" defaultValue={ue?.currency ?? "JPY"} maxLength={3} className={field} aria-label="通貨" />
            {CFO_INPUTS.map(([k, label]) => (
              <div key={k} className="grid grid-cols-2 gap-2">
                <input name={k} type="number" step="any" min={0} placeholder={label} defaultValue={ue?.inputs?.[k] as number | undefined} className={field} aria-label={label} />
                <select name={`${k}.evidenceId`} className={field} defaultValue="">
                  <option value="">ASSUMPTION</option>
                  {evidenceOptions.map((e) => <option key={e.id} value={e.id}>FACT: {e.label}</option>)}
                </select>
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2">
              <input name="customers.conservative" type="number" min={0} placeholder="顧客数 保守" defaultValue={ue?.inputs?.customersScenario?.conservative} className={field} />
              <input name="customers.base" type="number" min={0} placeholder="基本" defaultValue={ue?.inputs?.customersScenario?.base} className={field} />
              <input name="customers.optimistic" type="number" min={0} placeholder="楽観" defaultValue={ue?.inputs?.customersScenario?.optimistic} className={field} />
            </div>
            <SubmitButton variant="secondary" pendingLabel="計算中…">CFO分析を実行</SubmitButton>
          </ActionForm>
        </details>
      </div>
    </div>
  );
}
