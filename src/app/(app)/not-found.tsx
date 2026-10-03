import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-3 py-10 text-center">
      <h1 className="text-lg font-bold">見つかりません</h1>
      <p className="text-sm text-muted">存在しないか、アクセス権がありません。</p>
      <Link href="/dashboard" className="text-sm text-accent underline">ダッシュボードへ</Link>
    </div>
  );
}
