"use client";
import { useState } from "react";
import { marketSizeAction } from "@/app/actions/analysis";
import type { StoredMarketEstimate } from "@/application/ports/repositories";
import { METHOD_INPUTS } from "@/domain/analysis/market-size";
import type { MarketSizeMethod } from "@/domain/opportunity/business-model";
import { ConfidenceBadge, EpistemicTag } from "../badges";
import { ActionForm } from "../forms/action-form";
import { SubmitButton } from "../submit-button";

const field = "min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm";
const METHOD_LABEL: Record<MarketSizeMethod, string> = { TOP_DOWN: "Top Down", BOTTOM_UP: "Bottom Up", VALUE_THEORY: "Value Theory" };

export function MarketSizeSection({ opportunityId, estimates, evidenceOptions }: { opportunityId: string; estimates: StoredMarketEstimate[]; evidenceOptions: Array<{ id: string; label: string }> }) {
  const [method, setMethod] = useState<MarketSizeMethod>("BOTTOM_UP");
  return (
    <div className="space-y-3" data-testid="market-size">
      {estimates.length === 0 ? <p className="text-sm text-muted">未推定（AIは市場規模の数値を生成しません。下の入力から計算します）</p> : (
        <ul className="space-y-2 text-sm">
          {estimates.map((m) => (
            <li key={m.id} className="rounded-xl border border-line p-3">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">{METHOD_LABEL[m.method]}: {m.resultValue.toLocaleString()} {m.currency}/年 <EpistemicTag status="CALCULATION" /> <ConfidenceBadge level={m.confidence} /></p>
              <p className="font-mono text-xs">{m.formula}</p>
              <ul className="mt-1 text-xs">
                {Object.entries(m.inputs).map(([k, v]) => <li key={k}>{k} = {v.value.toLocaleString()} {v.unit} <EpistemicTag status={v.epistemic} />{v.note ? ` — ${v.note}` : ""}</li>)}
              </ul>
              {m.assumptions.length ? <p className="mt-1 text-[11px] text-muted">仮定: {m.assumptions.join(" / ")}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={marketSizeAction} className="space-y-2 rounded-xl border border-line p-3">
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <div className="grid grid-cols-2 gap-2">
          <select name="method" value={method} onChange={(e) => setMethod(e.target.value as MarketSizeMethod)} className={field} aria-label="方式">
            {(Object.keys(METHOD_LABEL) as MarketSizeMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
          <input name="currency" defaultValue="JPY" maxLength={3} className={field} aria-label="通貨" />
        </div>
        {METHOD_INPUTS[method].map((i) => (
          <fieldset key={i.key} className="space-y-1 border-t border-line pt-2">
            <legend className="text-xs font-semibold">{i.label} <span className="font-mono text-muted">{i.key}</span> ({i.unit})</legend>
            <input name={`${i.key}.value`} type="number" step="any" min={0} required className={field} aria-label={i.label} />
            <select name={`${i.key}.evidenceId`} className={field} defaultValue="">
              <option value="">根拠なし → ASSUMPTION</option>
              {evidenceOptions.map((e) => <option key={e.id} value={e.id}>FACT: {e.label}</option>)}
            </select>
            <input name={`${i.key}.note`} maxLength={500} placeholder="出典・前提メモ" className={field} />
          </fieldset>
        ))}
        <SubmitButton variant="secondary">市場規模を計算</SubmitButton>
      </ActionForm>
    </div>
  );
}
