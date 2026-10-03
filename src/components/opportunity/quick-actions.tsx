"use client";
import { additionalResearchAction } from "@/app/actions/opportunity";
import { ActionForm } from "../forms/action-form";
import { SubmitButton } from "../submit-button";

const QUICK = [
  ["OVERSEAS_COMPARISON", "海外比較"],
  ["COMPETITOR", "競合調査"],
  ["WILLINGNESS_TO_PAY", "支払意思調査"],
] as const;

/** One-tap additional research runs linked to the opportunity. */
export function QuickResearchButtons({ opportunityId }: { opportunityId: string }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {QUICK.map(([type, label]) => (
        <ActionForm key={type} action={additionalResearchAction} className="contents">
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <input type="hidden" name="type" value={type} />
          <SubmitButton variant="secondary" pendingLabel="実行中…">{label}</SubmitButton>
        </ActionForm>
      ))}
    </div>
  );
}
