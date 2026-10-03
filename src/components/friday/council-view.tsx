import type { StoredAdvisorSession } from "@/application/ports/repositories";
import { EpistemicTag, Tag } from "../badges";

const STANCE = { SUPPORT: "支持", CONCERN: "懸念", NEUTRAL: "中立" } as const;

export function CouncilView({ session }: { session: StoredAdvisorSession }) {
  return (
    <div className="space-y-3 text-sm" data-testid="council">
      <p className="rounded-xl bg-accent/10 p-2 font-semibold">FRIDAY統合: {session.consensus}</p>
      <ul className="space-y-2">
        {session.perspectives.map((p) => (
          <li key={p.perspective} className="rounded-xl border border-line p-2">
            <p className="flex flex-wrap items-center gap-1.5 font-semibold">{p.label} <Tag>{STANCE[p.stance]}</Tag> <EpistemicTag status="INFERENCE" /></p>
            <p className="text-[11px] text-muted">視点: {p.lens}</p>
            <p className="mt-1">{p.opinion}</p>
            {p.concerns.length ? <p className="text-xs text-amber-700 dark:text-amber-300">懸念: {p.concerns.join(" / ")}</p> : null}
          </li>
        ))}
      </ul>
      {session.disagreements.length ? (
        <div><p className="text-xs font-semibold text-muted">Disagreement</p>{session.disagreements.map((d, i) => <p key={i} className="text-xs">{d.topic}: 支持 {d.support.join("、")} / 懸念 {d.concern.join("、")}</p>)}</div>
      ) : null}
      <List title="Unanswered Questions" items={session.unansweredQuestions} />
      <List title="Critical Assumptions" items={session.criticalAssumptions} />
      <List title="Required Evidence" items={session.requiredEvidence} />
      <p className="text-[11px] text-muted">各視点は公開されている意思決定原則を参考にした分析の観点であり、特定人物の発言・人格ではありません。最終判断は人間が行います。</p>
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-muted">{title}</p>
      <ul className="list-disc pl-5 text-xs">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}
