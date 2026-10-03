import { EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Watchlists" };

export default function Page() {
  return (
    <>
      <PageHeader title="Watchlists" />
      <EmptyState>Opportunity / Competitor / Industry / Problem / Persona / Country / Keyword / Technology / Regulation の定期監視は Milestone 3 で提供予定</EmptyState>
    </>
  );
}
