import Link from "next/link";

const TABS = [
  ["/settings/connectors", "Connectors"],
  ["/settings/scoring", "Scoring"],
  ["/settings/costs", "Costs"],
  ["/settings/security", "Security"],
  ["/settings/observability", "Logs"],
] as const;

export function SettingsNav() {
  return (
    <nav className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="設定">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} className="whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-xs">{label}</Link>
      ))}
      <Link href="/signals" className="whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-xs">Signals</Link>
      <Link href="/clusters" className="whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-xs">Clusters</Link>
      <Link href="/research/runs" className="whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-xs">Runs</Link>
    </nav>
  );
}
