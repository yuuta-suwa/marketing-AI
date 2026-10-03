import "server-only";
import { notFound, redirect } from "next/navigation";
import type { AppContext } from "@/application/context";
import { isDomainError } from "@/domain/shared/errors";
import { buildAppContext, getSession } from "@/infrastructure/server-context";

/** Server-component helper: authenticated AppContext or redirect to login. */
export async function pageContext(): Promise<AppContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  return buildAppContext(session);
}

/** Maps NOT_FOUND domain errors (incl. other-tenant ids) to a 404. */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}
