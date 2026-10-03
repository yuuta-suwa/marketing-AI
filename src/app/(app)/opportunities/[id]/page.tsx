import Link from "next/link";
import { getOpportunityDetail } from "@/application/queries";
import { ConfidenceBadge, EpistemicTag, OpportunityStatusPill, RunStatusPill, ScoreBadge, Tag } from "@/components/badges";
import { AdditionalResearchForm, DecisionPanel, RedTeamButton } from "@/components/forms/opportunity-actions";
import { FridayConsult } from "@/components/forms/friday-consult";
import { BusinessModelSection } from "@/components/opportunity/business-section";
import { CompetitorsSection } from "@/components/opportunity/competitors-section";
import { ExperimentsSection } from "@/components/opportunity/experiments-section";
import { MarketSizeSection } from "@/components/opportunity/market-size-section";
import { JumpLinks } from "@/components/opportunity/jump-links";
import { QuickResearchButtons } from "@/components/opportunity/quick-actions";
import { Card, EmptyState, Field, Notice, PageHeader, SectionTitle } from "@/components/ui";
import type { OpportunityTextField } from "@/domain/opportunity/opportunity";
import { allowedNextStatuses } from "@/domain/opportunity/status";
import { RUN_TYPE_LABEL_JA } from "@/domain/research/run";
import { interpretScoreAndConfidence } from "@/domain/scoring/confidence";
import { CRITERION_LABEL_JA, SCORE_CRITERIA } from "@/domain/scoring/criteria";
import type { EpistemicStatus } from "@/domain/shared/epistemic";
import { orNotFound, pageContext } from "@/lib/page-context";

export const metadata = { title: "事業機会" };

const SECTIONS: Array<[OpportunityTextField, string]> = [
  ["customer", "Customer"],
  ["situation", "Situation"],
  ["pain", "Pain"],
  ["desiredOutcome", "Desired Outcome"],
  ["currentAlternatives", "Current Alternatives"],
  ["marketGap", "Market Gap"],
  ["paySignal", "Pay Signal"],
  ["marketSizeSummary", "Market Size"],
  ["competitorsSummary", "Competitors"],
  ["revenueModel", "Business Model"],
  ["distributionStrategy", "Distribution"],
  ["moat", "Moat"],
  ["aiNecessity", "AI Necessity"],
  ["regulatoryRisk", "Regulatory Risk"],
  ["mainRisk", "Main Risk"],
  ["nextExperiment", "Next Experiment"],
  ["killCriteria", "Kill Criteria"],
];

const VERDICT_JA = { PROCEED: "進めてよい", PROCEED_WITH_CAUTION: "慎重に進める", NEEDS_EVIDENCE: "証拠が必要", STOP: "中止を推奨" } as const;

export default async function OpportunityPage({ params }: PageProps<"/opportunities/[id]">) {
  const { id } = await params;
  const ctx = await pageContext();
  const d = await orNotFound(getOpportunityDetail(ctx, id));
  const o = d.opportunity;
  const review = d.redTeam[0];
  const prov = o.fieldProvenance as Record<string, EpistemicStatus>;
  const evidenceOptions = d.evidence.map((e) => ({ id: e.id, label: e.evidenceText.slice(0, 40) }));
  const sources = new Set(d.evidence.map((e) => (e.source ? `${e.source.connectorId}:${e.source.sourceName}` : e.sourceItemId)));

  return (
    <>
      <PageHeader title={o.title} action={<ScoreBadge score={o.scoreTotal} />} />
      <div className="-mt-2 mb-3 flex flex-wrap items-center gap-1.5">
        <ConfidenceBadge level={o.confidence} />
        <OpportunityStatusPill status={o.status} />
        {o.scoreTotal !== null ? <span className="text-xs text-muted">{interpretScoreAndConfidence(o.scoreTotal, o.confidence)}</span> : null}
      </div>
      <Card>
        <dl className="grid grid-cols-4 gap-2 text-center text-sm">
          <div><dd className="font-bold">{d.evidence.length}</dd><dt className="text-[11px] text-muted">Evidence</dt></div>
          <div><dd className="font-bold">{d.cluster?.signalCount ?? 0}</dd><dt className="text-[11px] text-muted">Signal</dt></div>
          <div><dd className="font-bold">{sources.size}</dd><dt className="text-[11px] text-muted">Source多様性</dt></div>
          <div><dd className="font-bold">{o.momentum}</dd><dt className="text-[11px] text-muted">Momentum</dt></div>
        </dl>
      </Card>

      <JumpLinks />
      <div className="mt-2"><QuickResearchButtons opportunityId={o.id} /></div>

      <SectionTitle>Opportunity</SectionTitle>
      <Card>
        {SECTIONS.map(([key, label]) => (
          <Field key={key} label={label} tag={<EpistemicTag status={prov[key]} />}>
            {o[key]}
          </Field>
        ))}
      </Card>

      <SectionTitle hint={`${d.evidence.length}件`}>Evidence</SectionTitle>
      <ul className="space-y-2" data-testid="evidence-list">
        {d.evidence.map((e) => (
          <li key={e.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
            <blockquote className="border-l-2 border-accent pl-2">「{e.evidenceText}」</blockquote>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <EpistemicTag status="FACT" />
              <Tag>{e.evidenceType}</Tag>
              <span>{e.source?.sourceName ?? "source"}</span>
              {e.source?.publishedAt ? <span>· {new Date(e.source.publishedAt).toLocaleDateString("ja-JP")}</span> : null}
              {e.sourceUrl ? <a href={e.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline">出典</a> : null}
            </div>
          </li>
        ))}
      </ul>

      <SectionTitle hint={d.score ? `カバー率 ${Math.round(d.score.score.coverage * 100)}%` : undefined}>Score Breakdown</SectionTitle>
      {d.score ? (
        <Card>
          <ul className="space-y-2 text-sm">
            {SCORE_CRITERIA.map((c) => {
              const comp = d.score!.score.components[c];
              return (
                <li key={c}>
                  <div className="flex items-center justify-between gap-2">
                    <span>{CRITERION_LABEL_JA[c]} <span className="text-xs text-muted">×{comp.weight}</span></span>
                    <span className="flex items-center gap-1.5"><EpistemicTag status={comp.epistemic} /> {comp.points.toFixed(1)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-line"><div className={`h-1.5 rounded-full ${comp.assumed ? "bg-zinc-400" : "bg-accent"}`} style={{ width: `${comp.appliedValue * 100}%` }} /></div>
                  <p className="mt-0.5 text-xs text-muted">{comp.rationale}</p>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Confidence: {d.score.confidenceBreakdown.level}（品質 {d.score.confidenceBreakdown.sourceQuality} / 多様性 {d.score.confidenceBreakdown.sourceDiversity} / 鮮度 {d.score.confidenceBreakdown.freshness} / 量 {d.score.confidenceBreakdown.evidenceVolume} / 一致 {d.score.confidenceBreakdown.crossSourceAgreement}）
            {d.score.confidenceBreakdown.caps.length ? ` 上限適用: ${d.score.confidenceBreakdown.caps.join(", ")}` : ""}
          </p>
        </Card>
      ) : <EmptyState>スコア未算出</EmptyState>}

      <div id="red-team" />
      <SectionTitle>Red Team</SectionTitle>
      {review ? (
        <Card>
          <Notice tone={review.verdict === "STOP" ? "error" : review.verdict === "PROCEED" ? "ok" : "warn"}>判定: {VERDICT_JA[review.verdict]}（{review.createdBy}）</Notice>
          <ul className="mt-3 space-y-3 text-sm" data-testid="red-team-findings">
            {review.findings.map((f) => (
              <li key={f.key}>
                <p className="flex flex-wrap items-center gap-1.5 font-semibold">{f.question} <Tag>{f.severity}</Tag> <EpistemicTag status={f.epistemic} /></p>
                <p className="mt-0.5">{f.answer}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : <EmptyState>Red Teamは未実施です</EmptyState>}
      <div className="mt-2"><RedTeamButton opportunityId={o.id} /></div>

      <SectionTitle>Competitors</SectionTitle>
      <Card><CompetitorsSection opportunityId={o.id} competitors={d.competitors} evidenceOptions={evidenceOptions} /></Card>

      <div id="market-size" />
      <SectionTitle>Market Size</SectionTitle>
      <Card><MarketSizeSection opportunityId={o.id} estimates={d.marketEstimates} evidenceOptions={evidenceOptions} /></Card>

      <SectionTitle>Business Model / CFO</SectionTitle>
      <Card><BusinessModelSection opportunityId={o.id} models={d.businessModels} evidenceOptions={evidenceOptions} /></Card>

      <SectionTitle>Experiments</SectionTitle>
      <Card><ExperimentsSection opportunityId={o.id} experiments={d.experiments} defaults={{ hypothesis: o.nextExperiment, killCriteria: o.killCriteria }} /></Card>

      <div id="additional" />
      <SectionTitle>追加調査</SectionTitle>
      <Card><AdditionalResearchForm opportunityId={o.id} /></Card>
      {d.relatedRuns.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {d.relatedRuns.map((r) => (
            <li key={r.id}>
              <Link href={`/research/runs/${r.id}`} className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                {RUN_TYPE_LABEL_JA[r.runType]} <RunStatusPill status={r.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div id="friday" />
      <SectionTitle>FRIDAY相談</SectionTitle>
      <Card><FridayConsult opportunities={[{ id: o.id, title: o.title }]} defaultId={o.id} /></Card>

      <div id="decision" />
      <SectionTitle>Human Decision</SectionTitle>
      <Card><DecisionPanel opportunityId={o.id} status={o.status} nextStatuses={allowedNextStatuses(o.status)} /></Card>
      {d.decisions.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-muted" data-testid="decision-log">
          {d.decisions.map((x) => (
            <li key={x.id}>{new Date(x.createdAt).toLocaleString("ja-JP")} · {x.decision} · {x.fromStatus} → {x.toStatus ?? "—"} {x.rationale ? `· ${x.rationale}` : ""}</li>
          ))}
        </ul>
      ) : null}

      <div id="poc" />
      <SectionTitle>顧問会議 / PoC仕様書</SectionTitle>
      <EmptyState>Advisor Council（M3）・PoC Spec / Claude Code Export（M4）で提供予定</EmptyState>
    </>
  );
}
