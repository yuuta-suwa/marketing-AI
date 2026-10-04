"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Snapshot = { status: string; progressPercent: number; currentAction: string | null };
const TERMINAL = new Set(["COMPLETED", "PARTIAL_SUCCESS", "FAILED", "CANCELLED"]);

/**
 * Live research progress. Prefers Supabase Realtime (row updates on
 * research_runs, RLS-filtered); falls back to controlled polling with
 * backoff (2s → 10s, paused while the tab is hidden) when Realtime is
 * unavailable. Stops entirely once the run is terminal.
 */
export function RunProgress({ runId, initial, realtime }: { runId: string; initial: Snapshot; realtime: boolean }) {
  const router = useRouter();
  // Latest Realtime row; server re-renders provide `initial`. Progress only moves
  // forward, so the further-along snapshot wins.
  const [live, setLive] = useState<Snapshot | null>(null);
  const snap = live && (live.progressPercent > initial.progressPercent || TERMINAL.has(live.status)) ? live : initial;
  const [channel, setChannel] = useState<"realtime" | "polling">(realtime ? "realtime" : "polling");
  const lastRefresh = useRef(0);
  const done = TERMINAL.has(snap.status);

  // Realtime subscription (Supabase mode only).
  useEffect(() => {
    if (!realtime || done) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { createSupabaseBrowserClient } = await import("@/infrastructure/supabase/browser-client");
        const supabase = createSupabaseBrowserClient();
        const ch = supabase
          .channel(`run:${runId}`)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "research_runs", filter: `id=eq.${runId}` }, (payload) => {
            const row = payload.new as { status: string; progress_percent: number; current_action: string | null };
            setLive({ status: row.status, progressPercent: row.progress_percent, currentAction: row.current_action });
            // Re-render server data at most every 3s (stage boundaries, results).
            const now = Date.now();
            if (now - lastRefresh.current > 3000 || TERMINAL.has(row.status)) {
              lastRefresh.current = now;
              router.refresh();
            }
          })
          .subscribe((status) => {
            if (cancelled) return;
            if (status === "SUBSCRIBED") setChannel("realtime");
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setChannel("polling");
          });
        cleanup = () => void supabase.removeChannel(ch);
      } catch {
        setChannel("polling");
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [realtime, done, runId, router]);

  // Polling: the fallback, plus a slow safety net while Realtime is connected.
  useEffect(() => {
    if (done) return;
    let delay = channel === "realtime" ? 15_000 : 2_000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!document.hidden) router.refresh();
      if (channel === "polling") delay = Math.min(10_000, Math.round(delay * 1.5));
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [channel, done, router]);

  const pct = Math.max(0, Math.min(100, Math.round(snap.progressPercent)));
  return (
    <div className="mb-4" data-testid="run-progress" data-percent={pct}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span data-testid="run-action">{snap.currentAction ?? "準備中"}</span>
        <span className="font-mono text-xs">{pct}%</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      {!done ? (
        <p className="mt-1 text-[11px] text-muted" data-testid="progress-channel">
          更新方式: {channel === "realtime" ? "Realtime" : "Polling（自動更新）"} · 画面を閉じても処理はバックグラウンドで続きます
        </p>
      ) : null}
    </div>
  );
}
