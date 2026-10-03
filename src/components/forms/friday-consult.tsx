"use client";
import { useActionState } from "react";
import { fridayConsultAction, type FridayState } from "@/app/actions/opportunity";
import { Notice } from "../ui";
import { SubmitButton } from "../submit-button";

const INITIAL: FridayState = { ok: true, message: "" };

export function FridayConsult({ opportunities, defaultId }: { opportunities: Array<{ id: string; title: string }>; defaultId?: string }) {
  const [state, action] = useActionState(fridayConsultAction, INITIAL);
  const b = state.briefing;
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-2">
        <label htmlFor="friday-opp" className="block text-xs font-semibold text-muted">相談する事業機会</label>
        <select id="friday-opp" name="opportunityId" defaultValue={defaultId} className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm">
          {opportunities.map((o) => (
            <option key={o.id} value={o.id}>{o.title}</option>
          ))}
        </select>
        <SubmitButton pendingLabel="FRIDAYが整理中…">FRIDAYに相談</SubmitButton>
      </form>
      {!state.ok ? <Notice tone="error">{state.message}</Notice> : null}
      {b ? (
        <div className="space-y-2 rounded-2xl border border-accent/40 bg-surface p-4 text-sm" data-testid="friday-briefing">
          <p className="font-semibold">{b.headline}</p>
          <p>スコア {b.score === null ? "—" : Math.round(b.score)} / 証拠 {b.confidence} — {b.interpretation}</p>
          <p>Evidence {b.evidenceCount}件 / Red Team: {b.redTeamVerdict ?? "未実施"}</p>
          {b.mainRisk ? <p>主なリスク: {b.mainRisk}</p> : null}
          {b.unknowns.length ? <p className="text-muted">未評価: {b.unknowns.slice(0, 6).join("、")}</p> : null}
          <p className="rounded-xl bg-accent/10 p-2 font-semibold">推奨アクション: {b.recommendedNextAction}</p>
          <p className="text-xs text-muted">最終判断は人間が行います。</p>
        </div>
      ) : null}
    </div>
  );
}
