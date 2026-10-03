"use client";
import { additionalResearchAction, decisionAction, redTeamAction } from "@/app/actions/opportunity";
import { RUN_TYPE_LABEL_JA } from "@/domain/research/run";
import { OPPORTUNITY_STATUS_LABEL_JA, HUMAN_GATED_STATUSES, type OpportunityStatus } from "@/domain/opportunity/status";
import { ActionForm } from "./action-form";
import { SubmitButton } from "../submit-button";

const ADDITIONAL = ["ADDITIONAL", "OVERSEAS_COMPARISON", "COMPETITOR", "WILLINGNESS_TO_PAY", "MARKET_SIZE", "REGULATION", "PRICING", "DISTRIBUTION"] as const;

export function RedTeamButton({ opportunityId }: { opportunityId: string }) {
  return (
    <ActionForm action={redTeamAction}>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <SubmitButton pendingLabel="Red Team実行中…">Red Teamを実行</SubmitButton>
    </ActionForm>
  );
}

export function AdditionalResearchForm({ opportunityId }: { opportunityId: string }) {
  return (
    <ActionForm action={additionalResearchAction} className="space-y-2">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <label className="block text-xs font-semibold text-muted" htmlFor="ar-type">調査の種類</label>
      <select id="ar-type" name="type" className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm">
        {ADDITIONAL.map((t) => (
          <option key={t} value={t}>{RUN_TYPE_LABEL_JA[t]}</option>
        ))}
      </select>
      <input name="note" maxLength={500} placeholder="補足（任意）" className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm" />
      <textarea name="manual" rows={3} placeholder="追加の手動データ（任意・空行区切り）" className="w-full rounded-xl border border-line bg-bg p-3 text-sm" />
      <SubmitButton variant="secondary" pendingLabel="追加調査を実行中…">追加調査を開始</SubmitButton>
    </ActionForm>
  );
}

export function DecisionPanel({ opportunityId, status, nextStatuses }: { opportunityId: string; status: OpportunityStatus; nextStatuses: readonly OpportunityStatus[] }) {
  const advance = nextStatuses.filter((s) => !["REJECTED", "ON_HOLD"].includes(s));
  return (
    <ActionForm action={decisionAction} className="space-y-2">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <textarea name="rationale" rows={2} maxLength={2000} placeholder="判断理由（記録されます）" className="w-full rounded-xl border border-line bg-bg p-3 text-sm" />
      {advance.length > 0 ? (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-muted" htmlFor="toStatus">次のステータスへ（現在: {OPPORTUNITY_STATUS_LABEL_JA[status]}）</label>
          <select id="toStatus" name="toStatus" className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm">
            {advance.map((s) => (
              <option key={s} value={s}>
                {OPPORTUNITY_STATUS_LABEL_JA[s]}{HUMAN_GATED_STATUSES.has(s) ? "（人間の承認）" : ""}
              </option>
            ))}
          </select>
          <SubmitButton name="decision" value="APPROVE">承認して進める</SubmitButton>
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <SubmitButton variant="secondary" name="decision" value="WATCH">Watch</SubmitButton>
        <SubmitButton variant="secondary" name="decision" value="HOLD">保留</SubmitButton>
        <SubmitButton variant="danger" name="decision" value="REJECT">却下</SubmitButton>
      </div>
    </ActionForm>
  );
}
