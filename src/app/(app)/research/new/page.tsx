import { ResearchForm } from "@/components/forms/research-form";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "新規調査" };

export default async function NewResearchPage({ searchParams }: PageProps<"/research/new">) {
  const q = (await searchParams).q;
  return (
    <>
      <PageHeader title="新規調査" subtitle="自然言語で指示すると、Directive作成 → 収集 → Evidence → Signal → Cluster → Opportunity まで自動で進みます。" />
      <ResearchForm defaultInput={typeof q === "string" ? q.slice(0, 4000) : ""} />
    </>
  );
}
