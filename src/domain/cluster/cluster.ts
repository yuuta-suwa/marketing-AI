import type { ConfidenceLevel } from "../shared/confidence";
import { mean, round, unique } from "../shared/math";
import type { SignalType } from "../signal/signal";
import { centroid, cosineSimilarity } from "./similarity";

export type ClusterableSignal = {
  id: string;
  signalType: SignalType;
  category?: string;
  embedding: number[];
  urgencyScore: number;
  willingnessToPayScore: number;
  confidence: ConfidenceLevel;
  /** Distinct source identity (connector + source name) for diversity. */
  sourceKeys: string[];
  countries: string[];
  languages: string[];
  observedAt: string[];
};

export type ClusterDraft = {
  signalIds: string[];
  similarities: Record<string, number>;
  centroid: number[];
  signalCount: number;
  sourceCount: number;
  countries: string[];
  languages: string[];
  firstSeen?: string;
  lastSeen?: string;
  momentum: number;
  painScore: number;
  paySignalScore: number;
  dominantType: SignalType;
};

export type ClusterOptions = {
  /** Cosine threshold to join a cluster. */
  threshold?: number;
  /** Rule-based guard: only merge signals in compatible categories. */
  requireSameCategory?: boolean;
  /** Reference "now" for momentum (ISO string). */
  now?: string;
  /** Window (days) used to compute momentum. */
  momentumWindowDays?: number;
};

/**
 * MVP clustering: single-pass centroid clustering over embeddings, with a
 * rule-based category guard. Deterministic for a given input order; signals
 * are sorted by id first so results are reproducible.
 */
export function clusterSignals(signals: readonly ClusterableSignal[], options: ClusterOptions = {}): ClusterDraft[] {
  const threshold = options.threshold ?? 0.55;
  const sorted = [...signals].sort((a, b) => a.id.localeCompare(b.id));
  const groups: Array<{ members: ClusterableSignal[]; centroid: number[]; category?: string }> = [];

  for (const s of sorted) {
    let best: (typeof groups)[number] | undefined;
    let bestSim = -1;
    for (const g of groups) {
      if (options.requireSameCategory && g.category && s.category && g.category !== s.category) continue;
      const sim = cosineSimilarity(s.embedding, g.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        best = g;
      }
    }
    if (best && bestSim >= threshold) {
      best.members.push(s);
      best.centroid = centroid(best.members.map((m) => m.embedding));
      best.category ??= s.category;
    } else {
      groups.push({ members: [s], centroid: [...s.embedding], category: s.category });
    }
  }

  return groups
    .map((g) => summarizeCluster(g.members, g.centroid, options))
    .sort((a, b) => b.signalCount - a.signalCount || b.painScore - a.painScore);
}

export function summarizeCluster(
  members: readonly ClusterableSignal[],
  c: number[],
  options: ClusterOptions = {},
): ClusterDraft {
  const observed = members.flatMap((m) => m.observedAt).filter(Boolean).sort();
  const typeCounts = new Map<SignalType, number>();
  for (const m of members) typeCounts.set(m.signalType, (typeCounts.get(m.signalType) ?? 0) + 1);
  const dominantType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const similarities: Record<string, number> = {};
  for (const m of members) similarities[m.id] = round(cosineSimilarity(m.embedding, c), 4);

  return {
    signalIds: members.map((m) => m.id),
    similarities,
    centroid: c,
    signalCount: members.length,
    sourceCount: unique(members.flatMap((m) => m.sourceKeys)).length,
    countries: unique(members.flatMap((m) => m.countries)).sort(),
    languages: unique(members.flatMap((m) => m.languages)).sort(),
    firstSeen: observed[0],
    lastSeen: observed[observed.length - 1],
    momentum: computeMomentum(observed, options.now, options.momentumWindowDays),
    painScore: Math.round(mean(members.map((m) => m.urgencyScore))),
    paySignalScore: Math.round(mean(members.map((m) => m.willingnessToPayScore))),
    dominantType,
  };
}

/**
 * Momentum = share of observations in the recent window vs the prior window
 * of the same length, mapped to -100..100. With no history it is 0 (unknown),
 * never a guess.
 */
export function computeMomentum(observedAt: readonly string[], now?: string, windowDays = 30): number {
  if (observedAt.length === 0) return 0;
  const ref = now ? Date.parse(now) : Date.now();
  const w = windowDays * 86_400_000;
  let recent = 0;
  let prior = 0;
  for (const t of observedAt) {
    const ts = Date.parse(t);
    if (Number.isNaN(ts)) continue;
    if (ts > ref - w && ts <= ref) recent++;
    else if (ts > ref - 2 * w && ts <= ref - w) prior++;
  }
  if (recent + prior === 0) return 0;
  return round(((recent - prior) / (recent + prior)) * 100, 1);
}
