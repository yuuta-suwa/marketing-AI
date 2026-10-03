"use client";
import { addCompetitorAction, analyzeCompetitorsAction } from "@/app/actions/analysis";
import type { StoredCompetitor } from "@/application/ports/repositories";
import { EpistemicTag, Tag } from "../badges";
import { ActionForm } from "../forms/action-form";
import { SubmitButton } from "../submit-button";

const field = "min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm";

export function CompetitorsSection({ opportunityId, competitors, evidenceOptions }: { opportunityId: string; competitors: StoredCompetitor[]; evidenceOptions: Array<{ id: string; label: string }> }) {
  return (
    <div className="space-y-3" data-testid="competitors">
      {competitors.length === 0 ? <p className="text-sm text-muted">競合・代替手段は未分析です。</p> : (
        <ul className="space-y-2 text-sm">
          {competitors.map((c) => (
            <li key={c.id} className="rounded-xl border border-line p-3">
              <p className="flex flex-wrap items-center gap-1.5 font-semibold">{c.name} <Tag>{c.competitorType}</Tag> <EpistemicTag status={c.epistemicStatus} /></p>
              {c.pricing ? <p className="text-xs">価格: {c.pricing}</p> : null}
              {c.positioning ? <p className="text-xs">ポジション: {c.positioning}</p> : null}
              {c.customerComplaints ? <p className="text-xs text-muted">顧客の不満:「{c.customerComplaints}」</p> : null}
              {c.weaknesses ? <p className="text-xs">弱み: {c.weaknesses}</p> : null}
              {c.marketGap ? <p className="text-xs">ギャップ: {c.marketGap}</p> : null}
              <p className="text-[11px] text-muted">Evidence {c.sourceEvidenceIds.length}件</p>
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={analyzeCompetitorsAction}>
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <SubmitButton variant="secondary" pendingLabel="分析中…">Evidenceから競合を分析</SubmitButton>
      </ActionForm>
      <details className="rounded-xl border border-line p-3">
        <summary className="cursor-pointer text-sm font-semibold">競合を手動追加</summary>
        <ActionForm action={addCompetitorAction} className="mt-2 space-y-2">
          <input type="hidden" name="opportunityId" value={opportunityId} />
          <input name="name" required maxLength={120} placeholder="名称" className={field} />
          <select name="competitorType" className={field} defaultValue="DIRECT">
            <option value="DIRECT">直接競合</option><option value="INDIRECT">間接競合</option><option value="ALTERNATIVE">代替手段</option>
          </select>
          <input name="url" type="url" placeholder="URL（任意）" className={field} />
          <input name="pricing" placeholder="価格（任意）" className={field} />
          <input name="positioning" placeholder="ポジショニング（任意）" className={field} />
          <input name="weaknesses" placeholder="弱み（任意）" className={field} />
          <select name="evidenceId" className={field} defaultValue="">
            <option value="">根拠Evidenceなし（ASSUMPTIONとして保存）</option>
            {evidenceOptions.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
          <SubmitButton variant="secondary">追加</SubmitButton>
        </ActionForm>
      </details>
    </div>
  );
}
