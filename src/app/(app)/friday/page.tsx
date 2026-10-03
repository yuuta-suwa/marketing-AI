import Link from "next/link";
import { FridayConsult } from "@/components/forms/friday-consult";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "FRIDAY" };

export default async function FridayPage() {
  const ctx = await pageContext();
  const opportunities = await ctx.repos.opportunities.listOpportunities({ limit: 50 });
  return (
    <>
      <PageHeader title="FRIDAY" subtitle="Executive Interface — 調査指示・相談・判断の窓口。最終判断は人間が行います。" />
      <SectionTitle>Directive</SectionTitle>
      <Card>
        <form action="/research/new" method="get" className="space-y-2">
          <textarea name="q" rows={3} placeholder="例: 訪日客の移動の不満から事業機会を探して" className="w-full rounded-xl border border-line bg-bg p-3 text-sm" />
          <button className="min-h-11 w-full rounded-xl bg-accent text-sm font-semibold text-white">調査を指示</button>
        </form>
      </Card>
      <SectionTitle>Consult</SectionTitle>
      <Card>
        {opportunities.length === 0 ? <EmptyState>相談できる事業機会がありません。<Link className="underline" href="/research/new">調査を開始</Link></EmptyState> : (
          <FridayConsult opportunities={opportunities.map((o) => ({ id: o.id, title: o.title }))} />
        )}
      </Card>
    </>
  );
}
