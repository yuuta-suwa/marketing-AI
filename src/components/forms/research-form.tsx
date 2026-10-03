"use client";
import { useActionState } from "react";
import { startResearchAction } from "@/app/actions/research";
import { INITIAL_ACTION_STATE } from "@/app/actions/result";
import { Notice } from "../ui";
import { SubmitButton } from "../submit-button";

const EXAMPLES = ["日本の旅行市場で、利用者が困っていることから新規事業を探して", "中小企業のバックオフィスの不満から事業機会を探す"];

export type SourceOption = { id: string; name: string; runnable: boolean; reason: string | null };

const input = "min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm";

export function ResearchForm({ defaultInput = "", sources }: { defaultInput?: string; sources: SourceOption[] }) {
  const [state, action] = useActionState(startResearchAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="input" className="mb-1 block text-sm font-semibold">何を調べたいですか？</label>
        <textarea id="input" name="input" required minLength={4} maxLength={4000} rows={4} defaultValue={defaultInput} placeholder={EXAMPLES[0]} className="w-full rounded-xl border border-line bg-surface p-3 text-base" />
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              className="rounded-full border border-line px-3 py-1 text-xs text-muted"
              onClick={(ev) => {
                const ta = ev.currentTarget.form?.elements.namedItem("input") as HTMLTextAreaElement | null;
                if (ta) ta.value = e;
              }}
            >
              {e.slice(0, 18)}…
            </button>
          ))}
        </div>
      </div>

      <details className="rounded-xl border border-line bg-surface p-3">
        <summary className="cursor-pointer text-sm font-semibold">手動インポート（テキスト・URL・CSV）</summary>
        <p className="mt-2 text-xs text-muted">利用権限のあるデータのみ。テキストは空行区切り、先頭行「source: 出典名」で出典を記録します。</p>
        <textarea name="manual" rows={6} maxLength={200000} className="mt-2 w-full rounded-xl border border-line bg-bg p-3 text-sm" placeholder={"source: 顧客インタビュー 9月\n空港からホテルまでの移動が分かりにくい。\n\nコインロッカーが足りない。"} />
        <label className="mt-2 block text-xs font-semibold text-muted" htmlFor="urls">URL（1行に1つ・最大20・robots.txtを順守）</label>
        <textarea id="urls" name="urls" rows={2} maxLength={8000} className="mt-1 w-full rounded-xl border border-line bg-bg p-3 text-sm" placeholder="https://example.com/article" />
        <label className="mt-2 block text-xs font-semibold text-muted" htmlFor="csv">CSV（ヘッダー: body/text/本文 必須、title, url, source, published_at, country, language 任意）</label>
        <input id="csv" type="file" name="csv" accept=".csv,text/csv" className="mt-1 block w-full text-sm" />
      </details>

      <details className="rounded-xl border border-line bg-surface p-3" data-testid="advanced">
        <summary className="cursor-pointer text-sm font-semibold">Advanced</summary>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-muted">Country
            <select name="country" className={input} defaultValue="">
              <option value="">自動</option>
              {["JP", "US", "GB", "KR", "TW", "CN", "SG", "TH", "VN", "DE", "FR", "GLOBAL"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">Language
            <select name="language" className={input} defaultValue="">
              <option value="">自動</option>
              {["ja", "en", "ko", "zh"].map((l) => <option key={l}>{l}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">Date Range
            <select name="timeRange" className={input} defaultValue="90d">
              <option value="7d">7日</option><option value="30d">30日</option><option value="90d">90日</option><option value="1y">1年</option><option value="all">全期間</option>
            </select>
          </label>
          <label className="text-xs text-muted">Maximum Items
            <input type="number" name="maxItems" min={1} max={500} defaultValue={50} className={input} />
          </label>
          <label className="text-xs text-muted">Budget (USD / run)
            <input type="number" name="budget" min={0} max={1000} step="0.05" defaultValue={0.5} className={input} />
          </label>
          <label className="flex items-end gap-2 pb-3 text-sm">
            <input type="checkbox" name="deepResearch" className="size-4" /> Deep Research
          </label>
        </div>
        <fieldset className="mt-3">
          <legend className="text-xs font-semibold text-muted">Sources（未選択 = 実行可能なものすべて）</legend>
          <ul className="mt-1 space-y-1">
            {sources.map((s) => (
              <li key={s.id}>
                <label className={`flex items-center gap-2 text-sm ${s.runnable ? "" : "text-muted"}`}>
                  <input type="checkbox" name="sources" value={s.id} disabled={!s.runnable} className="size-4" />
                  {s.name}
                  {!s.runnable && s.reason ? <span className="text-[11px]">（{s.reason}）</span> : null}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </details>

      {!state.ok && state.message ? <Notice tone="error">{state.message}</Notice> : null}
      <SubmitButton pendingLabel="調査を開始しています…">調査を開始</SubmitButton>
    </form>
  );
}
