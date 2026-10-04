import { OpportunityCard } from "@/components/opportunity-card";
import { EmptyState, PageHeader } from "@/components/ui";
import { PAGE_SIZE, Pagination, pageFrom } from "@/components/pagination";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "事業機会" };

export default async function OpportunitiesPage({ searchParams }: PageProps<"/opportunities">) {
  const ctx = await pageContext();
  const page = pageFrom((await searchParams).page);
  const fetched = await ctx.repos.opportunities.listOpportunities({ limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE });
  const hasNext = fetched.length > PAGE_SIZE;
  const items = fetched.slice(0, PAGE_SIZE);
  return (
    <>
      <PageHeader title="事業機会" subtitle="Score（魅力度）と Confidence（証拠の強さ）は別の軸です。" />
      <div className="space-y-3">
        {items.length === 0 ? <EmptyState>事業機会はまだありません</EmptyState> : items.map((o) => <OpportunityCard key={o.id} opportunity={o} />)}
      </div>
    <Pagination basePath="/opportunities" page={page} hasNext={hasNext} />
    </>
  );
}
