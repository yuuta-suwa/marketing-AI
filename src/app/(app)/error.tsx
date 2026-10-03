"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-3 py-10 text-center">
      <h1 className="text-lg font-bold">エラーが発生しました</h1>
      <p className="text-sm text-muted">処理は記録されています。もう一度お試しください。</p>
      <button onClick={reset} className="min-h-11 rounded-xl border border-line px-4 text-sm">再試行</button>
    </div>
  );
}
