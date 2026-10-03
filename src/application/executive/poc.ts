import type { AppContext } from "@/application/context";
import type { StoredReport } from "@/application/ports/repositories";
import { authorize } from "@/domain/auth/authorization";
import { buildClaudeCodePrompt } from "@/domain/executive/claude-code-export";
import { generatePocSpec } from "@/domain/executive/poc-spec";
import { buildDossier } from "./dossier";

/**
 * PoC spec from the dossier. Producing a spec for an EXPERIMENT_APPROVED
 * opportunity proposes the PoC (POC_PROPOSED — not an approval).
 */
export async function generatePocSpecReport(ctx: AppContext, opportunityId: string): Promise<StoredReport> {
  authorize(ctx.actor, "analysis.run");
  const dossier = await buildDossier(ctx, opportunityId);
  if (dossier.opportunity.status === "EXPERIMENT_APPROVED") {
    dossier.opportunity = await ctx.repos.opportunities.setStatus(opportunityId, "POC_PROPOSED");
  }
  const spec = generatePocSpec(dossier);
  const report = await ctx.repos.executive.saveReport({
    reportType: "POC_SPEC",
    title: `PoC Spec — ${spec.title}`,
    contentMd: spec.markdown,
    contentJson: { approved: spec.approved, sections: spec.sections, status: dossier.opportunity.status },
    opportunityId,
  });
  await ctx.repos.ops.audit("friday.poc_spec", "opportunity", opportunityId, { reportId: report.id, approved: spec.approved });
  return report;
}

/** CLAUDE_CODE_BUILD_PROMPT — only after human PoC approval. */
export async function exportClaudeCodePrompt(ctx: AppContext, opportunityId: string): Promise<StoredReport> {
  authorize(ctx.actor, "analysis.run");
  const dossier = await buildDossier(ctx, opportunityId);
  const spec = generatePocSpec(dossier);
  const prompt = buildClaudeCodePrompt(spec, { opportunityId, generatedAt: ctx.clock.now().toISOString() });
  const report = await ctx.repos.executive.saveReport({
    reportType: "CLAUDE_CODE_PROMPT",
    title: `CLAUDE_CODE_BUILD_PROMPT — ${spec.title}`,
    contentMd: prompt,
    contentJson: { opportunityId },
    opportunityId,
  });
  await ctx.repos.ops.audit("friday.claude_code_export", "opportunity", opportunityId, { reportId: report.id });
  return report;
}
