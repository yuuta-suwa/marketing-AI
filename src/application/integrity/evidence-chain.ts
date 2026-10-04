import type { AppContext } from "@/application/context";
import { authorize } from "@/domain/auth/authorization";
import type { SourceItem } from "@/domain/source/source-item";

export type ChainReport = {
  ok: boolean;
  checkedOpportunities: number;
  checkedSignals: number;
  checkedEvidence: number;
  violations: string[];
};

/**
 * Verifies, through the organization-scoped repositories, that every
 * opportunity can be traced:
 *   Opportunity → Cluster → Signals → Evidence → SourceItem → original URL/source
 * Any id that cannot be resolved inside the organization (broken, invented or
 * belonging to another tenant) is a violation. Evidence must be a verbatim
 * excerpt of its source item.
 */
export async function checkEvidenceChain(ctx: AppContext, filter: { runId?: string; limit?: number } = {}): Promise<ChainReport> {
  authorize(ctx.actor, "research.read");
  const violations: string[] = [];
  const opps = await ctx.repos.opportunities.listOpportunities({ runId: filter.runId, limit: filter.limit ?? 500 });
  const sourceCache = new Map<string, Map<string, SourceItem>>();
  const sourcesOf = async (runId: string) => {
    let m = sourceCache.get(runId);
    if (!m) {
      m = new Map((await ctx.repos.evidence.listSourceItems(runId)).map((s) => [s.id, s]));
      sourceCache.set(runId, m);
    }
    return m;
  };
  let checkedSignals = 0;
  const checkedEvidence = new Set<string>();

  for (const o of opps) {
    const tag = `opportunity ${o.id}`;
    const evidenceIds = await ctx.repos.opportunities.listOpportunityEvidenceIds(o.id);
    if (evidenceIds.length === 0) violations.push(`${tag}: no evidence linked`);
    const evidence = await ctx.repos.evidence.listEvidence({ ids: evidenceIds });
    const found = new Set(evidence.map((e) => e.id));
    for (const id of evidenceIds) if (!found.has(id)) violations.push(`${tag}: evidence ${id} not resolvable in this organization`);

    const cluster = await ctx.repos.signals.getCluster(o.clusterId);
    if (!cluster) {
      violations.push(`${tag}: cluster ${o.clusterId} not resolvable`);
      continue;
    }
    if (cluster.signalIds.length === 0) violations.push(`${tag}: cluster ${cluster.id} has no signals`);
    const signals = await ctx.repos.signals.listSignals({ ids: cluster.signalIds });
    checkedSignals += signals.length;
    const signalFound = new Set(signals.map((s) => s.id));
    for (const id of cluster.signalIds) if (!signalFound.has(id)) violations.push(`${tag}: signal ${id} not resolvable`);
    const clusterEvidence = new Set(signals.flatMap((s) => s.evidenceIds));
    const signalEvidence = await ctx.repos.evidence.listEvidence({ ids: [...clusterEvidence] });
    const signalEvidenceFound = new Set(signalEvidence.map((e) => e.id));
    for (const s of signals) {
      if (s.evidenceIds.length === 0) violations.push(`signal ${s.id}: cites no evidence`);
      for (const id of s.evidenceIds) if (!signalEvidenceFound.has(id)) violations.push(`signal ${s.id}: evidence ${id} not resolvable`);
    }
    // Evidence from the opportunity's own run must come from its cluster's signals
    // (evidence from later additional-research runs is linked explicitly).
    for (const e of evidence) {
      if (e.researchRunId === o.researchRunId && !clusterEvidence.has(e.id)) {
        violations.push(`${tag}: evidence ${e.id} is not supported by the cluster's signals`);
      }
    }

    for (const e of [...evidence, ...signalEvidence]) {
      if (checkedEvidence.has(e.id)) continue;
      checkedEvidence.add(e.id);
      const source = (await sourcesOf(e.researchRunId)).get(e.sourceItemId);
      if (!source) {
        violations.push(`evidence ${e.id}: source item ${e.sourceItemId} not resolvable`);
        continue;
      }
      if (!source.body.includes(e.evidenceText)) violations.push(`evidence ${e.id}: not a verbatim excerpt of its source`);
      const traceable = Boolean(source.sourceUrl) || source.sourceType === "MANUAL";
      if (!traceable) violations.push(`evidence ${e.id}: source ${source.id} has no URL`);
      if (source.sourceUrl && e.sourceUrl && e.sourceUrl !== source.sourceUrl) violations.push(`evidence ${e.id}: URL differs from its source item`);
    }
  }
  return { ok: violations.length === 0, checkedOpportunities: opps.length, checkedSignals, checkedEvidence: checkedEvidence.size, violations };
}
