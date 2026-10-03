"use client";
import { useActionState } from "react";
import { startResearchAction } from "@/app/actions/research";
import { INITIAL_ACTION_STATE } from "@/app/actions/result";
import { Notice } from "../ui";
import { SubmitButton } from "../submit-button";

const EXAMPLES = ["日本の旅行市場で、利用者が困っていることから新規事業を探して", "中小企業のバックオフィスの不満から事業機会を探す"];

export function ResearchForm({ defaultInput = "" }: { defaultInput?: string }) {
  const [state, action] = useActionState(startResearchAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label htmlFor="input" className="mb-1 block text-sm font-semibold">何を調べますか？</label>
        <textarea
          id="input"
          name="input"
          required
          minLength={4}
          maxLength={4000}
          rows={4}
          defaultValue={defaultInput}
          placeholder={EXAMPLES[0]}
          className="w-full rounded-xl border border-line bg-surface p-3 text-base"
        />
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
      <details className="rounded-xl border border-line bg-surface p-3" open>
        <summary className="cursor-pointer text-sm font-semibold">手動インポート（インタビュー・アンケート等）</summary>
        <p className="mt-2 text-xs text-muted">
          利用権限のあるテキストのみ。空行で区切ると別アイテムになります。先頭行に「source: 出典名」と書くと出典を記録します。
        </p>
        <textarea
          name="manual"
          rows={8}
          maxLength={200000}
          className="mt-2 w-full rounded-xl border border-line bg-bg p-3 text-sm"
          placeholder={"source: 顧客インタビュー 9月\n空港からホテルまでの移動が分かりにくい。\n\nコインロッカーが足りない。"}
        />
      </details>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="deepResearch" className="size-4" /> Deep Research（予算内のみ）
        </label>
        <label className="flex items-center gap-2 text-xs text-muted">
          最大件数
          <input type="number" name="maxItems" min={1} max={500} defaultValue={50} className="w-16 rounded-lg border border-line bg-bg p-1 text-right" />
        </label>
      </div>
      {!state.ok && state.message ? <Notice tone="error">{state.message}</Notice> : null}
      <SubmitButton pendingLabel="調査を開始しています…">調査を開始</SubmitButton>
    </form>
  );
}
