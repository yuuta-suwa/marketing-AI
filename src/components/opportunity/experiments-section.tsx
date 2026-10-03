"use client";
import { advanceExperimentAction, createExperimentAction } from "@/app/actions/analysis";
import type { Experiment } from "@/domain/analysis/experiment";
import { Tag } from "../badges";
import { ActionForm } from "../forms/action-form";
import { SubmitButton } from "../submit-button";

const field = "min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm";

export function ExperimentsSection({ opportunityId, experiments, defaults }: { opportunityId: string; experiments: Experiment[]; defaults: { hypothesis?: string; killCriteria?: string } }) {
  return (
    <div className="space-y-3" data-testid="experiments">
      {experiments.map((x) => (
        <div key={x.id} className="rounded-xl border border-line p-3 text-sm">
          <p className="flex items-center justify-between gap-2 font-semibold">{x.title} <Tag>{x.status}</Tag></p>
          <dl className="mt-1 grid grid-cols-[5rem_1fr] gap-x-2 text-xs">
            <dt className="text-muted">Hypothesis</dt><dd>{x.hypothesis}</dd>
            <dt className="text-muted">Test</dt><dd>{x.method}</dd>
            <dt className="text-muted">Metric</dt><dd>{x.metric}</dd>
            <dt className="text-muted">Target</dt><dd>{x.target}</dd>
            <dt className="text-muted">Cost</dt><dd>${x.budgetUsd}</dd>
            <dt className="text-muted">Deadline</dt><dd>{x.deadline}</dd>
            {x.resultSummary ? (<><dt className="text-muted">Result</dt><dd>{x.resultSummary}</dd></>) : null}
            {x.decision ? (<><dt className="text-muted">Decision</dt><dd>{x.decision}</dd></>) : null}
          </dl>
          {x.status !== "COMPLETED" && x.status !== "CANCELLED" ? (
            <ActionForm action={advanceExperimentAction} className="mt-2 space-y-2">
              <input type="hidden" name="opportunityId" value={opportunityId} />
              <input type="hidden" name="experimentId" value={x.id} />
              {x.status === "RUNNING" ? (
                <>
                  <textarea name="resultSummary" rows={2} placeholder="結果（必須）" className="w-full rounded-xl border border-line bg-bg p-2 text-sm" />
                  <select name="decision" className={field} defaultValue="CONTINUE">
                    <option value="CONTINUE">CONTINUE</option><option value="PIVOT">PIVOT</option><option value="STOP">STOP</option><option value="SCALE">SCALE</option>
                  </select>
                  <SubmitButton name="op" value="complete">結果を記録して完了</SubmitButton>
                </>
              ) : (
                <SubmitButton name="op" value={x.status === "PROPOSED" ? "approve" : "start"}>{x.status === "PROPOSED" ? "承認（人間）" : "開始"}</SubmitButton>
              )}
              <SubmitButton variant="danger" name="op" value="cancel">中止</SubmitButton>
            </ActionForm>
          ) : null}
        </div>
      ))}
      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-sm font-semibold">実験を作成</summary>
        <ActionForm action={createExperimentAction} className="mt-2 space-y-2">
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <input name="title" required maxLength={200} placeholder="タイトル" className={field} />
          <textarea name="hypothesis" required rows={2} defaultValue={defaults.hypothesis} placeholder="Hypothesis" className="w-full rounded-xl border border-line bg-bg p-2 text-sm" />
          <input name="method" required placeholder="Test（例: LP+広告、インタビュー10名）" className={field} />
          <input name="metric" required placeholder="Metric（例: 事前登録率）" className={field} />
          <input name="target" required placeholder="Target（例: 5%以上）" className={field} />
          <div className="grid grid-cols-2 gap-2">
            <input name="budgetUsd" type="number" min={0} step="any" required placeholder="Cost (USD)" className={field} />
            <input name="deadline" type="date" required className={field} aria-label="Deadline" />
          </div>
          <input name="killCriteria" defaultValue={defaults.killCriteria} placeholder="撤退基準" className={field} />
          <SubmitButton variant="secondary">作成</SubmitButton>
        </ActionForm>
      </details>
    </div>
  );
}
