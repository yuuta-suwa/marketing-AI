"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes the server-rendered run page while the pipeline is active. */
export function RunPoller({ active, intervalMs = 2000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
