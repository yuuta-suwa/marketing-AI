import type { ConfidenceLevel } from "../shared/confidence";

/** Snapshot stored per watchlist (watchlists.settings.snapshot). */
export type WatchSnapshot = {
  score?: number | null;
  confidence?: ConfidenceLevel;
  competitorNames?: string[];
  matchingSignals?: number;
  regulationSignals?: number;
  priceSignals?: number;
  checkedAt: string;
};

export type ChangeEvent = {
  kind: "SCORE_JUMP" | "CONFIDENCE_CHANGE" | "NEW_COMPETITOR" | "REGULATION_CHANGE" | "PRICE_SHIFT" | "SIGNAL_SURGE";
  severity: "INFO" | "IMPORTANT" | "CRITICAL";
  title: string;
  body: string;
};

export const THRESHOLDS = { scoreDelta: 10, surgeMin: 5, surgeFactor: 2, priceMin: 3 } as const;

/**
 * Only meaningful changes become notifications. The first observation
 * (no previous snapshot) establishes a baseline and never notifies.
 */
export function detectChanges(label: string, prev: WatchSnapshot | undefined, curr: WatchSnapshot): ChangeEvent[] {
  if (!prev) return [];
  const events: ChangeEvent[] = [];
  if (prev.score != null && curr.score != null && Math.abs(curr.score - prev.score) >= THRESHOLDS.scoreDelta) {
    const up = curr.score > prev.score;
    events.push({ kind: "SCORE_JUMP", severity: up ? "IMPORTANT" : "INFO", title: `${label}: スコア${up ? "大幅上昇" : "大幅低下"}`, body: `${prev.score} → ${curr.score}` });
  }
  if (prev.confidence && curr.confidence && prev.confidence !== curr.confidence) {
    events.push({ kind: "CONFIDENCE_CHANGE", severity: "INFO", title: `${label}: 証拠の信頼度が変化`, body: `${prev.confidence} → ${curr.confidence}` });
  }
  const newCompetitors = (curr.competitorNames ?? []).filter((n) => !(prev.competitorNames ?? []).includes(n));
  if (prev.competitorNames && newCompetitors.length > 0) {
    events.push({ kind: "NEW_COMPETITOR", severity: "IMPORTANT", title: `${label}: 新しい競合`, body: newCompetitors.join("、") });
  }
  if ((curr.regulationSignals ?? 0) > 0) {
    events.push({ kind: "REGULATION_CHANGE", severity: "IMPORTANT", title: `${label}: 規制・制度に関するシグナル`, body: `${curr.regulationSignals}件の新規シグナル` });
  }
  if ((curr.priceSignals ?? 0) >= THRESHOLDS.priceMin) {
    events.push({ kind: "PRICE_SHIFT", severity: "INFO", title: `${label}: 価格に関する不満が増加`, body: `${curr.priceSignals}件の新規価格シグナル` });
  }
  const baseline = prev.matchingSignals ?? 0;
  const now = curr.matchingSignals ?? 0;
  if (now >= THRESHOLDS.surgeMin && now >= THRESHOLDS.surgeFactor * Math.max(1, baseline)) {
    events.push({ kind: "SIGNAL_SURGE", severity: "IMPORTANT", title: `${label}: 市場シグナル急増`, body: `前回 ${baseline}件 → 今回 ${now}件` });
  }
  return events;
}
