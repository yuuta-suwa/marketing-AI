import Link from "next/link";
import type { Opportunity } from "@/domain/opportunity/opportunity";
import { interpretScoreAndConfidence } from "@/domain/scoring/confidence";
import { ConfidenceBadge, OpportunityStatusPill, ScoreBadge } from "./badges";

/** Mobile card: everything needed for a first go/no-go glance. */
export function OpportunityCard({ opportunity: o }: { opportunity: Opportunity }) {
  return (
    <Link
      href={`/opportunities/${o.id}`}
      className="block rounded-2xl border border-line bg-surface p-4 shadow-sm transition active:scale-[0.99]"
      data-testid="opportunity-card"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-snug">{o.title}</h3>
        <ScoreBadge score={o.scoreTotal} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ConfidenceBadge level={o.confidence} />
        <OpportunityStatusPill status={o.status} />
        {o.momentum !== 0 ? (
          <span className="text-[11px] text-muted">勢い {o.momentum > 0 ? "▲" : "▼"}{Math.abs(o.momentum)}</span>
        ) : null}
      </div>
      {o.scoreTotal !== null ? <p className="mt-1 text-xs text-muted">{interpretScoreAndConfidence(o.scoreTotal, o.confidence)}</p> : null}
      <dl className="mt-3 space-y-1.5 text-sm">
        <Row k="顧客" v={o.customer} />
        <Row k="痛み" v={o.pain} clamp />
        <Row k="支払意思" v={o.paySignal} clamp />
        <Row k="収益モデル" v={o.revenueModel} clamp />
        <Row k="主なリスク" v={o.mainRisk} clamp />
      </dl>
    </Link>
  );
}

function Row({ k, v, clamp }: { k: string; v?: string; clamp?: boolean }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={clamp ? "line-clamp-2" : ""}>{v ?? "—"}</dd>
    </div>
  );
}
