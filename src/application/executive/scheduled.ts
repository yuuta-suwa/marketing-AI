import type { AppContext } from "@/application/context";
import type { StoredWatchlist } from "@/application/ports/repositories";
import type { JobStore } from "@/application/jobs/ports";
import { publishDailyBrief } from "./daily-brief";
import { checkWatchlists } from "./watchlist";

/** Cross-tenant listing for system jobs only (service role / demo store). */
export interface SystemDirectory {
  listActiveWatchlists(): Promise<StoredWatchlist[]>;
  /** One recipient per organization for the daily brief (owner/admin). */
  listBriefRecipients(): Promise<Array<{ organizationId: string; userId: string }>>;
}

/** Builds a tenant-scoped system context acting for one user of one organization. */
export type SystemContextFactory = (organizationId: string, userId: string) => AppContext;

export async function runScheduledMonitoring(dir: SystemDirectory, ctxFor: SystemContextFactory) {
  const lists = await dir.listActiveWatchlists();
  const groups = new Map<string, StoredWatchlist[]>();
  for (const w of lists) {
    const key = `${w.organizationId}:${w.userId}`;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  let checked = 0;
  let notified = 0;
  const errors: string[] = [];
  for (const [key, ws] of groups) {
    const [org, user] = key.split(":");
    try {
      const r = await checkWatchlists(ctxFor(org, user), { watchlists: ws });
      checked += r.checked;
      notified += r.notified;
    } catch (e) {
      errors.push(`${org}: ${(e as Error).message}`);
    }
  }
  return { groups: groups.size, checked, notified, errors };
}

export async function runScheduledDailyBriefs(dir: SystemDirectory, ctxFor: SystemContextFactory) {
  let published = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const r of await dir.listBriefRecipients()) {
    try {
      const report = await publishDailyBrief(ctxFor(r.organizationId, r.userId));
      if (report) published++;
      else skipped++;
    } catch (e) {
      errors.push(`${r.organizationId}: ${(e as Error).message}`);
    }
  }
  return { published, skipped, errors };
}

/**
 * Cron entry point (Phase 5): instead of executing in the cron request, enqueue
 * one job per recipient. Keys are per hour (watchlists) / per day (brief), so a
 * cron fired twice never duplicates work. The worker executes them.
 */
export async function enqueueScheduledJobs(
  dir: SystemDirectory,
  store: Pick<JobStore, "enqueueFor">,
  kind: "WATCHLIST_REFRESH" | "DAILY_BRIEF",
  now: Date,
): Promise<{ enqueued: number; duplicates: number; errors: string[] }> {
  const recipients =
    kind === "DAILY_BRIEF"
      ? await dir.listBriefRecipients()
      : [...new Map((await dir.listActiveWatchlists()).map((w) => [`${w.organizationId}:${w.userId}`, { organizationId: w.organizationId, userId: w.userId }])).values()];
  const slot = kind === "DAILY_BRIEF" ? now.toISOString().slice(0, 10) : now.toISOString().slice(0, 13);
  let enqueued = 0;
  let duplicates = 0;
  const errors: string[] = [];
  for (const r of recipients) {
    try {
      const { created } = await store.enqueueFor(r.organizationId, r.userId, {
        jobType: kind,
        idempotencyKey: `${kind.toLowerCase()}:${r.userId}:${slot}`,
        priority: 500, // behind interactive research
        maxAttempts: 3,
      });
      if (created) enqueued++;
      else duplicates++;
    } catch (e) {
      errors.push(`${r.organizationId}: ${(e as Error).message}`);
    }
  }
  return { enqueued, duplicates, errors };
}
