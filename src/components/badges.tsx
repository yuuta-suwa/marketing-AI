import { OPPORTUNITY_STATUS_LABEL_JA, type OpportunityStatus } from "@/domain/opportunity/status";
import { RUN_STATUS_LABEL_JA, type ResearchRunStatus } from "@/domain/research/run-state-machine";
import type { EpistemicStatus } from "@/domain/shared/epistemic";
import type { ConfidenceLevel } from "@/domain/shared/confidence";

const pill = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5 whitespace-nowrap";

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className={`${pill} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>未スコア</span>;
  const tone = score >= 70 ? "bg-emerald-600 text-white" : score >= 50 ? "bg-amber-500 text-white" : "bg-zinc-500 text-white";
  return (
    <span className={`${pill} ${tone}`} aria-label={`スコア ${Math.round(score)}`}>
      {Math.round(score)}
      <span className="ml-0.5 font-normal opacity-80">/100</span>
    </span>
  );
}

const CONF: Record<ConfidenceLevel, string> = {
  LOW: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  MEDIUM: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  HIGH: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
};
const CONF_JA: Record<ConfidenceLevel, string> = { LOW: "証拠: 低", MEDIUM: "証拠: 中", HIGH: "証拠: 高" };

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  return <span className={`${pill} ${CONF[level]}`}>{CONF_JA[level]}</span>;
}

const EPI: Record<EpistemicStatus, string> = {
  FACT: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  INFERENCE: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  HYPOTHESIS: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200",
  ASSUMPTION: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  CALCULATION: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

export function EpistemicTag({ status }: { status?: EpistemicStatus }) {
  if (!status) return null;
  return <span className={`${pill} ${EPI[status]}`}>{status}</span>;
}

export function RunStatusPill({ status }: { status: ResearchRunStatus }) {
  const tone =
    status === "COMPLETED"
      ? "bg-emerald-600 text-white"
      : status === "PARTIAL_SUCCESS"
        ? "bg-amber-500 text-white"
        : status === "FAILED" || status === "CANCELLED"
          ? "bg-red-600 text-white"
          : "bg-sky-600 text-white";
  return <span className={`${pill} ${tone}`} data-testid="run-status" data-status={status}>{RUN_STATUS_LABEL_JA[status]}</span>;
}

export function OpportunityStatusPill({ status }: { status: OpportunityStatus }) {
  return <span className={`${pill} bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100`}>{OPPORTUNITY_STATUS_LABEL_JA[status]}</span>;
}

export function Tag({ children }: { children: React.ReactNode }) {
  return <span className={`${pill} bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}>{children}</span>;
}
