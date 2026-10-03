import { OpportunityCard } from "@/components/opportunity-card";
import { EmptyState, PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "事業機会" };

export default async function OpportunitiesPage() {
  const ctx = await pageContext();
  const items = await ctx.repos.opportunities.listOpportunities({ limit: 100 });
  return (
    <>
      <PageHeader title="事業機会" subtitle="Score（魅力度）と Confidence（証拠の強さ）は別の軸です。" />
      <div className="space-y-3">
        {items.length === 0 ? <EmptyState>事業機会はまだありません</EmptyState> : items.map((o) => <OpportunityCard key={o.id} opportunity={o} />)}
      </div>
    </>
  );
}
