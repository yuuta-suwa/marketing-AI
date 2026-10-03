import { Card, PageHeader } from "@/components/ui";
import { CRITERION_LABEL_JA, SCORE_CRITERIA } from "@/domain/scoring/criteria";
import { pageContext } from "@/lib/page-context";
import { SettingsNav } from "../nav";

export const metadata = { title: "Scoring" };

export default async function ScoringPage() {
  const ctx = await pageContext();
  const { weights, id } = await ctx.repos.ops.getScoringWeights();
  return (
    <>
      <PageHeader title="Scoring" subtitle="100点満点の重み（scoring_settingsで組織ごとに変更可能。合計100をDBで強制）。" />
      <SettingsNav />
      <Card>
        <ul className="space-y-1.5 text-sm">
          {SCORE_CRITERIA.map((c) => (
            <li key={c} className="flex justify-between"><span>{CRITERION_LABEL_JA[c]}</span><span className="font-mono">{weights[c]}</span></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">設定ID: {id ?? "default"}（編集UIは M3 で提供。管理者はSQL/APIで変更可能）</p>
      </Card>
    </>
  );
}
