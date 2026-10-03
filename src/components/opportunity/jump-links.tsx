const JUMP_LINKS = [
  ["#additional", "追加調査"],
  ["#market-size", "市場規模"],
  ["#red-team", "Red Team"],
  ["#decision", "Watch"],
  ["#friday", "FRIDAY"],
  ["#poc", "PoC"],
] as const;

/** In-page shortcuts to the opportunity actions (server component). */
export function JumpLinks() {
  return (
    <nav className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="操作">
      {JUMP_LINKS.map(([href, label]) => (
        <a key={href} href={href} className="whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-xs">{label}</a>
      ))}
    </nav>
  );
}
