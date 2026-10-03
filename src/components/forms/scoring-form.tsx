"use client";
import { useState } from "react";
import { scoringWeightsAction } from "@/app/actions/analysis";
import { ActionForm } from "./action-form";
import { SubmitButton } from "../submit-button";

export function ScoringForm({ criteria }: { criteria: Array<{ key: string; label: string; weight: number }> }) {
  const [values, setValues] = useState(() => Object.fromEntries(criteria.map((c) => [c.key, c.weight])));
  const total = Object.values(values).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return (
    <ActionForm action={scoringWeightsAction} className="space-y-2">
      {criteria.map((c) => (
        <label key={c.key} className="flex items-center justify-between gap-3 text-sm">
          {c.label}
          <input
            name={c.key}
            type="number"
            min={0}
            max={100}
            step="1"
            value={values[c.key]}
            onChange={(e) => setValues((v) => ({ ...v, [c.key]: Number(e.target.value) }))}
            className="min-h-10 w-20 rounded-lg border border-line bg-bg px-2 text-right font-mono"
          />
        </label>
      ))}
      <p className={`text-sm font-semibold ${total === 100 ? "text-emerald-600" : "text-red-600"}`} data-testid="weight-total">合計 {total} / 100</p>
      <SubmitButton>重みを保存</SubmitButton>
    </ActionForm>
  );
}
