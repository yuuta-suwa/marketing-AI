import { Card, PageHeader } from "@/components/ui";
import { ScoringForm } from "@/components/forms/scoring-form";
import { can } from "@/domain/auth/authorization";
import { CRITERION_LABEL_JA, SCORE_CRITERIA } from "@/domain/scoring/criteria";
import { pageContext } from "@/lib/page-context";
import { SettingsNav } from "../nav";

export const metadata = { title: "Scoring" };

export default async function ScoringPage() {
  const ctx = await pageContext();
  const { weights, id } = await ctx.repos.ops.getScoringWeights();
  const editable = can(ctx.actor, "scoring.configure");
  return (
    <>
      <PageHeader title="Scoring" subtitle="Opportunity Score（100点満点）の重み。合計100をアプリとDBの両方で強制。" />
      <SettingsNav />
      <Card>
        {editable ? (
          <ScoringForm criteria={SCORE_CRITERIA.map((c) => ({ key: c, label: CRITERION_LABEL_JA[c], weight: weights[c] }))} />
        ) : (
          <ul className="space-y-1.5 text-sm">
            {SCORE_CRITERIA.map((c) => <li key={c} className="flex justify-between"><span>{CRITERION_LABEL_JA[c]}</span><span className="font-mono">{weights[c]}</span></li>)}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">設定ID: {id ?? "default"} · 変更は以降の採点・再評価に適用されます（過去のスコアは当時の重みを保持）</p>
      </Card>
    </>
  );
}
