import { describe, expect, it } from "vitest";
import { createJobHandlers } from "@/application/jobs/handlers";
import type { JobHandlers } from "@/application/jobs/worker";
import { enqueueScheduledJobs } from "@/application/executive/scheduled";
import { createResearch } from "@/application/research/create-research";
import { dispatchResearch } from "@/application/research/dispatch";
import { runResearchStage } from "@/application/research/pipeline";
import { JobError } from "@/domain/jobs/job";
import { DomainError } from "@/domain/shared/errors";
import { MemoryDatabase } from "@/infrastructure/memory/memory-db";
import { MemoryJobStore } from "@/infrastructure/memory/memory-jobs";
import { createMemoryRepositories } from "@/infrastructure/memory/memory-repositories";
import { TRAVEL_VOICES } from "../fixtures/travel-voices";
import { ALICE, BOB, NOW, testContext, testWorker } from "../helpers/context";

/** Mutable clock shared by the store so leases/backoff can be advanced. */
function movableClock(start = NOW) {
  let t = start.getTime();
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

async function queuedRun(ctx = testContext(), manualItems = TRAVEL_VOICES) {
  const { run } = await createResearch(ctx, { input: "旅行市場の不満から新規事業を探す" });
  const dispatched = await dispatchResearch(ctx, run.id, { manualItems });
  return { ctx, run, dispatched };
}

async function counts(ctx: ReturnType<typeof testContext>, runId: string) {
  return {
    sourceItems: (await ctx.repos.evidence.listSourceItems(runId)).length,
    evidence: (await ctx.repos.evidence.listEvidence({ runId })).length,
    signals: (await ctx.repos.signals.listSignals({ runId })).length,
    clusters: (await ctx.repos.signals.listClusters({ runId })).length,
    opportunities: (await ctx.repos.opportunities.listOpportunities({ runId })).length,
  };
}

describe("async research execution", () => {
  it("POST only enqueues: the run stays QUEUED until a worker runs the chained stages", async () => {
    const { ctx, run, dispatched } = await queuedRun();
    expect(dispatched.jobStatus).toBe("QUEUED");
    expect((await ctx.repos.research.getRun(run.id))?.status).toBe("QUEUED");
    expect(await counts(ctx, run.id)).toEqual({ sourceItems: 0, evidence: 0, signals: 0, clusters: 0, opportunities: 0 });

    const processed = await testWorker(ctx).worker.drain();
    expect(processed).toBe(4);
    const jobs = await ctx.repos.jobs.list({ researchRunId: run.id });
    expect(jobs.map((j) => j.jobType).sort()).toEqual(["CLUSTER_GENERATION", "OPPORTUNITY_GENERATION", "RESEARCH_COLLECTION", "SIGNAL_EXTRACTION"]);
    expect(jobs.every((j) => j.status === "COMPLETED" && j.attemptCount === 1)).toBe(true);
    const done = await ctx.repos.research.getRun(run.id);
    expect(done).toMatchObject({ status: "COMPLETED", progressPercent: 100, currentAction: "調査が完了しました" });
    expect(done?.stats.checkpoints).toEqual(["collection", "evidence", "signals", "clusters", "opportunities"]);
    expect((await counts(ctx, run.id)).opportunities).toBeGreaterThanOrEqual(2);
    expect(ctx.db.audit.some((a) => a.action === "job.enqueued")).toBe(true);
  });

  it("progress is persisted stage by stage (what Realtime/polling shows)", async () => {
    const { ctx, run } = await queuedRun();
    const seen: Array<[string, number]> = [];
    const original = ctx.db.runs.set.bind(ctx.db.runs);
    ctx.db.runs.set = (id, value) => {
      if (id === run.id) seen.push([value.status, value.progressPercent]);
      return original(id, value);
    };
    await testWorker(ctx).worker.drain();
    const statuses = seen.map(([s, p]) => `${s}:${p}`);
    for (const expected of ["COLLECTING:20", "NORMALIZING:30", "EXTRACTING:50", "CLUSTERING:65", "ANALYZING:80", "VALIDATING:90", "COMPLETED:100"]) {
      expect(statuses).toContain(expected);
    }
    const percents = seen.map(([, p]) => p);
    expect(percents).toEqual([...percents].sort((a, b) => a - b)); // monotonic
  });

  it("enqueue is idempotent per key; dispatching twice returns the same job", async () => {
    const { ctx, run, dispatched } = await queuedRun();
    const again = await dispatchResearch(ctx, run.id);
    expect(again.jobId).toBe(dispatched.jobId);
    expect(await ctx.repos.jobs.list({ researchRunId: run.id })).toHaveLength(1);
  });

  it("duplicate queue delivery never duplicates evidence or opportunities", async () => {
    const { ctx, run } = await queuedRun();
    await testWorker(ctx).worker.drain();
    const before = await counts(ctx, run.id);
    // The same stages delivered again (e.g. a broker redelivery) under new message ids.
    for (const jobType of ["RESEARCH_COLLECTION", "SIGNAL_EXTRACTION", "CLUSTER_GENERATION", "OPPORTUNITY_GENERATION"] as const) {
      await ctx.repos.jobs.enqueue({ jobType, idempotencyKey: `redelivery:${jobType}`, researchRunId: run.id, payload: { manualItems: TRAVEL_VOICES } });
    }
    await testWorker(ctx).worker.drain();
    expect(await counts(ctx, run.id)).toEqual(before);
    // …and running a stage directly twice is equally harmless.
    await runResearchStage(ctx, run.id, "SIGNAL_EXTRACTION");
    await runResearchStage(ctx, run.id, "OPPORTUNITY_GENERATION");
    expect(await counts(ctx, run.id)).toEqual(before);
  });

  it("worker restart mid-job: the lease expires, another worker resumes without duplicates", async () => {
    // Baseline from an uninterrupted run with the same input.
    const clean = await queuedRun();
    await testWorker(clean.ctx).worker.drain();
    const baseline = await counts(clean.ctx, clean.run.id);

    const clock = movableClock();
    const { ctx, run } = await queuedRun();
    const store = new MemoryJobStore(ctx.db, clock);
    // Worker A finishes collection, then "crashes" inside signal extraction after a partial write.
    await testWorker(ctx, { store }).worker.runOnce();
    const [claimed] = await store.claim("worker-A", { limit: 1, leaseSeconds: 60 });
    expect(claimed.jobType).toBe("SIGNAL_EXTRACTION");
    const evidence = await ctx.repos.evidence.listEvidence({ runId: run.id });
    expect(evidence).toHaveLength(0);
    const crashing = { ...ctx, repos: { ...ctx.repos, signals: { ...ctx.repos.signals, insertSignals: async (rows: Parameters<typeof ctx.repos.signals.insertSignals>[0]) => {
      await ctx.repos.signals.insertSignals(rows.slice(0, 1)); // partial batch persisted…
      throw new Error("SIGKILL"); // …then the process dies
    } } } };
    await expect(runResearchStage(crashing, run.id, "SIGNAL_EXTRACTION")).rejects.toThrow("SIGKILL");
    expect((await ctx.repos.signals.listSignals({ runId: run.id })).length).toBe(1);
    expect((await ctx.repos.research.getRun(run.id))?.status).toBe("EXTRACTING");

    // Worker A never heartbeats again. Before the lease expires nobody else can take the job.
    expect(await store.claim("worker-B", { limit: 1, leaseSeconds: 60 })).toEqual([]);
    clock.advance(61_000);
    const B = testWorker(ctx, { store, options: { workerId: "worker-B" } });
    await B.worker.drain();
    expect(await store.complete(claimed.id, "worker-A")).toBe(false); // the dead worker cannot complete it

    const job = await ctx.repos.jobs.get(claimed.id);
    expect(job).toMatchObject({ status: "COMPLETED", attemptCount: 2 });
    const run2 = await ctx.repos.research.getRun(run.id);
    expect(run2?.status).toBe("COMPLETED");
    expect(run2?.stats.resumed).toBe(1);
    expect(await counts(ctx, run.id)).toEqual(baseline);
  });

  it("transient failures retry with backoff; success on a later attempt", async () => {
    const clock = movableClock();
    const { ctx, run } = await queuedRun();
    const store = new MemoryJobStore(ctx.db, clock);
    let failures = 1;
    const base = createJobHandlers();
    const handlers: JobHandlers = {
      ...base,
      RESEARCH_COLLECTION: async (args) => {
        if (failures-- > 0) throw new Error("ECONNRESET from database");
        return base.RESEARCH_COLLECTION!(args);
      },
    };
    const { worker } = testWorker(ctx, { store, handlers });
    await worker.drain();
    const [job] = await ctx.repos.jobs.list({ researchRunId: run.id });
    expect(job).toMatchObject({ status: "RETRYING", attemptCount: 1, lastError: "ECONNRESET from database" });
    expect(Date.parse(job.availableAt) - clock.now().getTime()).toBe(5_000); // base 10s, jitter 0 → 5s
    expect(await worker.drain()).toBe(0); // not before the backoff elapses
    clock.advance(5_000);
    await worker.drain();
    expect((await ctx.repos.research.getRun(run.id))?.status).toBe("COMPLETED");
  });

  it("max attempts exhausted → dead letter, run FAILED with the reason", async () => {
    const clock = movableClock();
    const ctx = testContext();
    const { run } = await createResearch(ctx, { input: "旅行の不満" });
    await ctx.repos.jobs.enqueue({ jobType: "RESEARCH_COLLECTION", idempotencyKey: "k", researchRunId: run.id, maxAttempts: 2 });
    const store = new MemoryJobStore(ctx.db, clock);
    const handlers: JobHandlers = { ...createJobHandlers(), RESEARCH_COLLECTION: async () => { throw new Error("upstream outage"); } };
    const { worker } = testWorker(ctx, { store, handlers });
    await worker.drain();
    clock.advance(60_000);
    await worker.drain();
    const [job] = await ctx.repos.jobs.list({ researchRunId: run.id });
    expect(job).toMatchObject({ status: "FAILED", deadLettered: true, attemptCount: 2 });
    expect(await ctx.repos.jobs.list({ deadLetteredOnly: true })).toHaveLength(1);
    const failed = await ctx.repos.research.getRun(run.id);
    expect(failed?.status).toBe("FAILED");
    expect(failed?.statusReason).toContain("upstream outage");

    // Admin re-queues the dead letter with fresh attempts.
    const requeued = await ctx.repos.jobs.requeueDeadLetter(job.id);
    expect(requeued).toMatchObject({ status: "QUEUED", attemptCount: 0, deadLettered: false });
  });

  it("non-retryable errors dead-letter immediately", async () => {
    const ctx = testContext();
    const { run } = await createResearch(ctx, { input: "旅行の不満" });
    await ctx.repos.jobs.enqueue({ jobType: "RESEARCH_COLLECTION", idempotencyKey: "k", researchRunId: run.id, payload: { manualUrls: ["not a url"] } });
    await testWorker(ctx).worker.drain();
    const [job] = await ctx.repos.jobs.list({ researchRunId: run.id });
    expect(job).toMatchObject({ status: "FAILED", deadLettered: true, attemptCount: 1 });
    expect((await ctx.repos.research.getRun(run.id))?.status).toBe("FAILED");
  });

  it("a crashed worker on its final attempt is dead-lettered by the next claim", async () => {
    const clock = movableClock();
    const { ctx, run } = await queuedRun();
    const store = new MemoryJobStore(ctx.db, clock);
    const [job] = await store.claim("worker-A", { limit: 1, leaseSeconds: 30 });
    ctx.db.jobs.set(job.id, { ...ctx.db.jobs.get(job.id)!, maxAttempts: 1 });
    clock.advance(31_000);
    expect(await store.claim("worker-B", { limit: 1, leaseSeconds: 30 })).toEqual([]);
    expect(await ctx.repos.jobs.get(job.id)).toMatchObject({ status: "FAILED", deadLettered: true });
    expect((await ctx.repos.research.getRun(run.id))?.status).toBe("FAILED");
  });

  it("only one worker owns a job; leases are exclusive and heartbeats extend them", async () => {
    const clock = movableClock();
    const { ctx } = await queuedRun();
    const store = new MemoryJobStore(ctx.db, clock);
    const [a] = await store.claim("A", { limit: 5, leaseSeconds: 30 });
    expect(await store.claim("B", { limit: 5, leaseSeconds: 30 })).toEqual([]);
    clock.advance(20_000);
    expect(await store.heartbeat(a.id, "A", 30)).toBe(true);
    clock.advance(20_000); // 40s after claim, but 20s after the heartbeat
    expect(await store.claim("B", { limit: 5, leaseSeconds: 30 })).toEqual([]);
    expect(await store.heartbeat(a.id, "B", 30)).toBe(false);
    expect(await store.fail(a.id, "B", "x", true, 1)).toBeNull();
  });

  it("cancellation: queued jobs stop the run; processing jobs stop at the next heartbeat", async () => {
    const { ctx, run, dispatched } = await queuedRun();
    await ctx.repos.jobs.cancel(dispatched.jobId);
    expect(await ctx.repos.jobs.get(dispatched.jobId)).toMatchObject({ status: "CANCELLED" });
    expect((await ctx.repos.research.getRun(run.id))?.status).toBe("CANCELLED");
    expect(await testWorker(ctx).worker.drain()).toBe(0);

    const second = await queuedRun(testContext({ db: ctx.db }));
    const store = new MemoryJobStore(ctx.db, ctx.clock);
    const handlers: JobHandlers = {
      ...createJobHandlers(),
      RESEARCH_COLLECTION: async ({ job, checkpoint }) => {
        await ctx.repos.jobs.cancel(job.id); // user presses cancel while it runs
        await checkpoint();
      },
    };
    await testWorker(ctx, { store, handlers }).worker.drain();
    expect(await ctx.repos.jobs.get(second.dispatched.jobId)).toMatchObject({ status: "CANCELLED" });
    expect((await ctx.repos.research.getRun(second.run.id))?.status).toBe("CANCELLED");
  });

  it("graceful shutdown hands claimed jobs back without consuming an attempt", async () => {
    const { ctx, dispatched } = await queuedRun();
    const store = new MemoryJobStore(ctx.db, ctx.clock);
    const { worker } = testWorker(ctx, { store });
    worker.stop();
    await worker.runOnce();
    expect(await ctx.repos.jobs.get(dispatched.jobId)).toMatchObject({ status: "RETRYING", attemptCount: 0, lockedBy: null });
  });
});

describe("queue tenancy and authorization", () => {
  it("jobs are organization-scoped (no IDOR via job or run ids)", async () => {
    const db = new MemoryDatabase();
    const alice = testContext({ db, actor: ALICE });
    const bob = testContext({ db, actor: BOB });
    const { run, dispatched } = await queuedRun(alice);
    expect(await bob.repos.jobs.get(dispatched.jobId)).toBeNull();
    expect(await bob.repos.jobs.list()).toEqual([]);
    await expect(bob.repos.jobs.cancel(dispatched.jobId)).rejects.toThrow();
    await expect(bob.repos.jobs.enqueue({ jobType: "RESEARCH_COLLECTION", idempotencyKey: "x", researchRunId: run.id })).rejects.toThrow(DomainError);
    await expect(dispatchResearch(bob, run.id)).rejects.toThrow();
  });

  it("viewers cannot enqueue; only admins can re-queue dead letters", async () => {
    const db = new MemoryDatabase();
    const owner = testContext({ db });
    const viewer = testContext({ db, actor: { ...ALICE, userId: "u-viewer", role: "viewer" } });
    const member = testContext({ db, actor: { ...ALICE, userId: "u-member", role: "member" } });
    const { run } = await createResearch(owner, { input: "旅行の不満" });
    await expect(viewer.repos.jobs.enqueue({ jobType: "RESEARCH_COLLECTION", idempotencyKey: "v", researchRunId: run.id })).rejects.toThrow(/not allowed/);
    const { job } = await member.repos.jobs.enqueue({ jobType: "RESEARCH_COLLECTION", idempotencyKey: "m", researchRunId: run.id });
    db.jobs.set(job.id, { ...job, status: "FAILED", deadLettered: true });
    await expect(member.repos.jobs.requeueDeadLetter(job.id)).rejects.toThrow();
    await expect(owner.repos.jobs.requeueDeadLetter(job.id)).resolves.toMatchObject({ status: "QUEUED" });
  });

  it("a job whose owner lost access is not executed", async () => {
    const { ctx, run } = await queuedRun();
    const store = new MemoryJobStore(ctx.db, ctx.clock);
    const { JobWorker } = await import("@/application/jobs/worker");
    const { silentLogger } = await import("@/lib/logger");
    const worker = new JobWorker({
      store,
      handlers: createJobHandlers(),
      logger: silentLogger,
      options: { workerId: "w", leaseSeconds: 60, heartbeatMs: 60_000, batchSize: 1 },
      contextFor: async () => {
        throw new DomainError("FORBIDDEN", "job owner is no longer a member of the organization");
      },
    });
    await worker.drain();
    const [job] = await ctx.repos.jobs.list({ researchRunId: run.id });
    expect(job).toMatchObject({ status: "FAILED", deadLettered: true });
    expect(await ctx.repos.evidence.listSourceItems(run.id)).toEqual([]);
  });

  it("worker contexts are scoped to the job's organization", async () => {
    const db = new MemoryDatabase();
    const alice = testContext({ db, actor: ALICE });
    const bob = testContext({ db, actor: BOB });
    const a = await queuedRun(alice);
    const b = await queuedRun(bob);
    await testWorker(alice).worker.drain(); // one worker drains both tenants' jobs
    const aliceEvidence = await alice.repos.evidence.listEvidence({ runId: a.run.id });
    const bobEvidence = await bob.repos.evidence.listEvidence({ runId: b.run.id });
    expect(aliceEvidence.length).toBeGreaterThan(0);
    expect(bobEvidence.length).toBeGreaterThan(0);
    const orgOf = (id: string) => db.evidence.get(id)?.organizationId;
    expect(new Set(aliceEvidence.map((e) => orgOf(e.id)))).toEqual(new Set(["org-a"]));
    expect(new Set(bobEvidence.map((e) => orgOf(e.id)))).toEqual(new Set(["org-b"]));
    expect(await alice.repos.evidence.listEvidence({ runId: b.run.id })).toEqual([]);
  });
});

describe("scheduled jobs", () => {
  it("cron enqueues one job per recipient per time slot (idempotent), the worker executes it", async () => {
    const ctx = testContext();
    const store = new MemoryJobStore(ctx.db, ctx.clock);
    const dir = {
      listActiveWatchlists: async () => [],
      listBriefRecipients: async () => [{ organizationId: ALICE.organizationId, userId: ALICE.userId }],
    };
    const first = await enqueueScheduledJobs(dir, store, "DAILY_BRIEF", NOW);
    const second = await enqueueScheduledJobs(dir, store, "DAILY_BRIEF", new Date(NOW.getTime() + 3_600_000));
    expect(first).toMatchObject({ enqueued: 1, duplicates: 0 });
    expect(second).toMatchObject({ enqueued: 0, duplicates: 1 });
    await testWorker(ctx, { store }).worker.drain();
    const [job] = await ctx.repos.jobs.list();
    expect(job).toMatchObject({ jobType: "DAILY_BRIEF", status: "COMPLETED" });
  });

  it("jobs without a required target fail permanently instead of looping", async () => {
    const ctx = testContext();
    await ctx.repos.jobs.enqueue({ jobType: "RED_TEAM", idempotencyKey: "rt" });
    await testWorker(ctx).worker.drain();
    const [job] = await ctx.repos.jobs.list();
    expect(job).toMatchObject({ status: "FAILED", deadLettered: true, attemptCount: 1 });
    expect(job.lastError).toContain("opportunity_id");
    expect(new JobError("x", false).retryable).toBe(false);
  });
});

it("system repositories used by the worker cannot read another tenant", async () => {
  const db = new MemoryDatabase();
  const { run } = await queuedRun(testContext({ db, actor: ALICE }));
  const bobSystem = createMemoryRepositories(db, BOB, { now: () => NOW }, { system: true });
  expect(await bobSystem.research.getRun(run.id)).toBeNull();
});
