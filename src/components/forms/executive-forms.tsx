"use client";
import { checkNowAction, councilAction, feedbackAction, pocSpecAction, watchAction } from "@/app/actions/executive";
import { ActionForm } from "./action-form";
import { SubmitButton } from "../submit-button";

const field = "min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm";

export function CouncilButton({ opportunityId }: { opportunityId: string }) {
  return (
    <ActionForm action={councilAction}>
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <SubmitButton variant="secondary" pendingLabel="顧問会議を開催中…">顧問会議を開く</SubmitButton>
    </ActionForm>
  );
}

export function PocButtons({ opportunityId, exportAllowed }: { opportunityId: string; exportAllowed: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <ActionForm action={pocSpecAction} className="contents">
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <SubmitButton variant="secondary" name="kind" value="spec" pendingLabel="生成中…">PoC仕様書を作成</SubmitButton>
      </ActionForm>
      <ActionForm action={pocSpecAction} className="contents">
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <SubmitButton variant={exportAllowed ? "primary" : "secondary"} name="kind" value="export" pendingLabel="生成中…">Claude Code Export</SubmitButton>
      </ActionForm>
    </div>
  );
}

export function WatchForm({ opportunities }: { opportunities: Array<{ id: string; title: string }> }) {
  return (
    <ActionForm action={watchAction} className="space-y-2">
      <select name="targetType" className={field} defaultValue="KEYWORD" aria-label="監視対象">
        <option value="KEYWORD">Keyword</option><option value="PROBLEM">Problem</option><option value="MARKET">Market</option>
        <option value="COUNTRY">Country（例: JP）</option><option value="COMPETITOR">Competitor</option><option value="OPPORTUNITY">Opportunity</option>
      </select>
      <input name="query" maxLength={200} placeholder="キーワード / 課題 / 市場 / 国コード / 競合名" className={field} aria-label="監視キーワード" />
      <select name="targetId" className={field} defaultValue="" aria-label="監視する事業機会">
        <option value="">（Opportunityを監視する場合に選択）</option>
        {opportunities.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
      </select>
      <SubmitButton>ウォッチに追加</SubmitButton>
    </ActionForm>
  );
}

export function CheckNowButton() {
  return (
    <ActionForm action={checkNowAction}>
      <SubmitButton variant="secondary" pendingLabel="チェック中…">今すぐチェック（ブリーフも更新）</SubmitButton>
    </ActionForm>
  );
}

export function FeedbackForm({ opportunityId, experiments }: { opportunityId: string; experiments: Array<{ id: string; title: string }> }) {
  return (
    <ActionForm action={feedbackAction} className="space-y-2">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <select name="metric" className={field} defaultValue="CUSTOMER_RESPONSE" aria-label="指標">
        <option value="CUSTOMER_RESPONSE">Customer Response</option><option value="CUSTOMER_INTERVIEW">Customer Interview</option>
        <option value="CONVERSION">Conversion（0-1）</option><option value="REVENUE">Revenue</option>
        <option value="RETENTION">Retention（0-1）</option><option value="CHURN">Churn（0-1）</option>
        <option value="FEEDBACK">Feedback</option><option value="LAUNCH_RESULT">Launch Result</option>
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input name="value" type="number" step="any" placeholder="数値" className={field} aria-label="数値" />
        <input name="unit" maxLength={40} placeholder="単位（JPY, %, 人…）" className={field} aria-label="単位" />
      </div>
      <select name="experimentId" className={field} defaultValue="" aria-label="関連する実験">
        <option value="">（実験と紐づけない）</option>
        {experiments.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
      </select>
      <textarea name="note" rows={2} maxLength={4000} placeholder="メモ（顧客の反応など）" className="w-full rounded-xl border border-line bg-bg p-2 text-sm" />
      <SubmitButton variant="secondary">結果を記録</SubmitButton>
    </ActionForm>
  );
}
