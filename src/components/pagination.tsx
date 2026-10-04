import Link from "next/link";

export const PAGE_SIZE = 20;

export function pageFrom(param: string | string[] | undefined): number {
  const n = Number(Array.isArray(param) ? param[0] : param);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

/** Simple prev/next pagination (fetch PAGE_SIZE + 1 to know if a next page exists). */
export function Pagination({ basePath, page, hasNext }: { basePath: string; page: number; hasNext: boolean }) {
  if (page === 1 && !hasNext) return null;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="ページ">
      {page > 1 ? <Link className="rounded-xl border border-line px-3 py-2" href={`${basePath}?page=${page - 1}`}>← 前へ</Link> : <span />}
      <span className="text-xs text-muted">{page}ページ</span>
      {hasNext ? <Link className="rounded-xl border border-line px-3 py-2" href={`${basePath}?page=${page + 1}`}>次へ →</Link> : <span />}
    </nav>
  );
}
