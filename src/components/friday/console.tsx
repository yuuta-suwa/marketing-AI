"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { fridayCommandAction, type FridayChatState } from "@/app/actions/executive";
import { SubmitButton } from "../submit-button";

type Line = { role: "user" | "friday"; text: string; link?: { href: string; label: string }; error?: boolean };

const QUICK = ["どう思う？", "Red Team", "顧問会議", "競合調査", "承認 理由: ", "保留", "ウォッチ", "実験", "PoC仕様書", "Claude Codeにエクスポート", "今日のブリーフ"];

/**
 * Conversation is kept in the browser only. FRIDAY persists decisions and
 * artefacts (via the server), never the chat transcript.
 */
export function FridayConsole({ opportunityId }: { opportunityId?: string }) {
  const [state, action] = useActionState(fridayCommandAction, { ok: true, message: "" } as FridayChatState);
  const [lines, setLines] = useState<Line[]>([
    { role: "friday", text: "FRIDAYです。調査指示・相談・判断の記録をお手伝いします。「help」で使い方を表示します。" },
  ]);
  const last = useRef<FridayChatState | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state === last.current || !state.echo) return;
    last.current = state;
    setLines((l) => [
      ...l,
      { role: "user", text: state.echo! },
      state.reply ? { role: "friday", text: state.reply.message, link: state.reply.link } : { role: "friday", text: state.message, error: true },
    ]);
    if (input.current) input.current.value = "";
  }, [state]);

  return (
    <div className="space-y-3" data-testid="friday-console">
      <ol className="max-h-96 space-y-2 overflow-y-auto" aria-live="polite">
        {lines.map((l, i) => (
          <li key={i} className={`rounded-2xl px-3 py-2 text-sm ${l.role === "user" ? "ml-8 bg-accent text-white" : `mr-8 border border-line bg-bg ${l.error ? "text-red-700 dark:text-red-300" : ""}`}`} data-role={l.role}>
            {l.text}
            {l.link ? <Link href={l.link.href} className="mt-1 block text-xs underline">{l.link.label} →</Link> : null}
          </li>
        ))}
      </ol>
      <form action={action} className="space-y-2">
        {opportunityId ? <input type="hidden" name="opportunityId" value={opportunityId} /> : null}
        <textarea ref={input} name="text" rows={2} maxLength={2000} placeholder="例: 訪日客の移動の不満から事業機会を探して / 承認 理由: 支払意思を確認" className="w-full rounded-xl border border-line bg-bg p-3 text-sm" aria-label="FRIDAYへの指示" />
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} type="button" className="rounded-full border border-line px-2.5 py-1 text-[11px]" onClick={() => { if (input.current) { input.current.value = q; input.current.focus(); } }}>
              {q.trim()}
            </button>
          ))}
        </div>
        <SubmitButton pendingLabel="FRIDAYが処理中…">送信</SubmitButton>
      </form>
    </div>
  );
}
