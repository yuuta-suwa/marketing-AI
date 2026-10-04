export default function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="読み込み中">
      <div className="h-7 w-1/2 animate-pulse rounded-lg bg-line" />
      <div className="h-24 animate-pulse rounded-2xl bg-line" />
      <div className="h-24 animate-pulse rounded-2xl bg-line" />
      <div className="h-24 animate-pulse rounded-2xl bg-line" />
    </div>
  );
}
