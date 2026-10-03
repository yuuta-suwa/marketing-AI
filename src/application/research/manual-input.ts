import type { ResearchRequest } from "@/domain/research/directive";

/**
 * Parses the mobile "manual import" textarea: items separated by blank
 * lines; an optional first line "source: <name>" labels the block's origin.
 */
export function parseManualInput(text: string, defaultSource = "Manual Import"): NonNullable<ResearchRequest["manualItems"]> {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .slice(0, 200)
    .map((block) => {
      const m = block.match(/^(?:source|出典)\s*[:：]\s*(.+)\n([\s\S]+)$/i);
      return m
        ? { sourceName: m[1].trim().slice(0, 120), body: m[2].trim().slice(0, 20000) }
        : { sourceName: defaultSource, body: block.slice(0, 20000) };
    });
}
