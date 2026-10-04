"use client";
import { qualityReviewAction } from "@/app/actions/research";
import { ActionForm } from "./action-form";
import { SubmitButton } from "../submit-button";

const DECISIONS = [
  ["NONE", "未判断"],
  ["DEEP_DIVE", "深掘りする"],
  ["EXPERIMENT", "実験へ"],
  ["HOLD", "保留"],
  ["REJECT", "見送り"],
] as const;

/** Human-only fields; the system never fills them. */
export function QualityReviewForm(props: {
  researchRunId: string;
  entityType: "SIGNAL" | "OPPORTUNITY";
  entityId: string;
  rating: number | null;
  decision: string;
  useful: boolean | null;
}) {
  return (
    <ActionForm action={qualityReviewAction} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <input type="hidden" name="researchRunId" value={props.researchRunId} />
      <input type="hidden" name="entityType" value={props.entityType} />
      <input type="hidden" name="entityId" value={props.entityId} />
      {props.entityType === "OPPORTUNITY" ? (
        <>
          <select name="rating" defaultValue={props.rating ?? ""} aria-label="Human rating" className="min-h-9 rounded-lg border border-line bg-bg px-2">
            <option value="">評価</option>
            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>★{n}</option>)}
          </select>
          <select name="decision" defaultValue={props.decision} aria-label="Human decision" className="min-h-9 rounded-lg border border-line bg-bg px-2">
            {DECISIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </>
      ) : (
        <select name="useful" defaultValue={props.useful === null ? "" : props.useful ? "yes" : "no"} aria-label="Useful signal" className="min-h-9 rounded-lg border border-line bg-bg px-2">
          <option value="">有用？</option>
          <option value="yes">有用</option>
          <option value="no">有用でない</option>
        </select>
      )}
      <SubmitButton variant="secondary">保存</SubmitButton>
    </ActionForm>
  );
}
