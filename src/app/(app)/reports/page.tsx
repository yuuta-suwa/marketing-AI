import { EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Reports" };

export default function Page() {
  return (
    <>
      <PageHeader title="Reports" />
      <EmptyState>Daily Market Brief は Milestone 3 で提供予定（意味のある変化がない日は通知しません）</EmptyState>
    </>
  );
}
