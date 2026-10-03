import type { AppContext } from "@/application/context";
import type { StoredAdvisorSession } from "@/application/ports/repositories";
import { authorize } from "@/domain/auth/authorization";
import { runAdvisorCouncil } from "@/domain/executive/advisor-council";
import { buildDossier } from "./dossier";

/** Advisor Council: 8 analytic perspectives integrated by FRIDAY. The human decides. */
export async function openAdvisorCouncil(ctx: AppContext, opportunityId: string): Promise<StoredAdvisorSession> {
  authorize(ctx.actor, "analysis.run");
  const dossier = await buildDossier(ctx, opportunityId);
  const session = await ctx.repos.executive.saveAdvisorSession(opportunityId, runAdvisorCouncil(dossier));
  await ctx.repos.ops.audit("friday.advisor_council", "opportunity", opportunityId, { sessionId: session.id });
  return session;
}
