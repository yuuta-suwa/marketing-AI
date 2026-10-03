import { listConnectorStatus } from "@/application/queries";
import { ResearchForm } from "@/components/forms/research-form";
import { PageHeader } from "@/components/ui";
import { pageContext } from "@/lib/page-context";

export const metadata = { title: "新規調査" };

export default async function NewResearchPage({ searchParams }: PageProps<"/research/new">) {
  const q = (await searchParams).q;
  const connectors = await listConnectorStatus(await pageContext());
  const sources = connectors
    .filter((c) => c.id !== "manual_import" && c.compliance !== "DISABLED_PENDING_COMPLIANCE")
    .map((c) => ({ id: c.id, name: c.name, runnable: c.runnable, reason: c.blockedReason }));
  return (
    <>
      <PageHeader title="新規調査" subtitle="自然言語で指示すると、Directive作成 → 収集 → Evidence → Signal → Cluster → Opportunity まで自動で進みます。" />
      <ResearchForm defaultInput={typeof q === "string" ? q.slice(0, 4000) : ""} sources={sources} />
    </>
  );
}
