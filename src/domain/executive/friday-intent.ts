import type { AdditionalResearchKind } from "./types";

export type FridayIntent =
  | { kind: "RESEARCH"; query: string }
  | { kind: "DEEP_RESEARCH"; type: AdditionalResearchKind }
  | { kind: "RED_TEAM" }
  | { kind: "COUNCIL" }
  | { kind: "APPROVE"; reason?: string }
  | { kind: "REJECT"; reason?: string }
  | { kind: "HOLD"; reason?: string }
  | { kind: "WATCH" }
  | { kind: "CONSULT" }
  | { kind: "EXPERIMENT" }
  | { kind: "POC_SPEC" }
  | { kind: "EXPORT" }
  | { kind: "BRIEF" }
  | { kind: "HELP" };

const reasonOf = (text: string) => {
  const m = text.match(/(?:理由|reason)[:：]\s*(.+)$/i) ?? text.match(/(?:なぜなら|because)\s*(.+)$/i);
  return m ? m[1].trim().slice(0, 1000) : undefined;
};

/**
 * Deterministic intent routing for FRIDAY commands (Japanese/English).
 * Order matters: specific actions before generic research requests.
 */
export function parseFridayIntent(raw: string): FridayIntent {
  // Classify on the command head only — the free-text reason must not change the intent.
  const full = raw.trim();
  const text = full.split(/(?:理由|reason)[:：]|なぜなら|because/i)[0].trim() || full;
  if (!text || /^(help|ヘルプ|何ができる)/i.test(text)) return { kind: "HELP" };
  if (/claude\s*code|エクスポート|export/i.test(text)) return { kind: "EXPORT" };
  if (/poc|仕様書/i.test(text)) return { kind: "POC_SPEC" };
  if (/顧問|council|アドバイザー/i.test(text)) return { kind: "COUNCIL" };
  if (/red\s*team|レッドチーム|反証/i.test(text)) return { kind: "RED_TEAM" };
  if (/ブリーフ|brief|今日の|daily/i.test(text)) return { kind: "BRIEF" };
  if (/却下|reject|見送/i.test(text)) return { kind: "REJECT", reason: reasonOf(full) };
  if (/保留|hold|待って/i.test(text)) return { kind: "HOLD", reason: reasonOf(full) };
  if (/承認|approve|進めて|ゴー|go ahead/i.test(text)) return { kind: "APPROVE", reason: reasonOf(full) };
  if (/ウォッチ|watch|監視/i.test(text)) return { kind: "WATCH" };
  if (/実験|experiment/i.test(text)) return { kind: "EXPERIMENT" };
  if (/海外|overseas|global/i.test(text)) return { kind: "DEEP_RESEARCH", type: "OVERSEAS_COMPARISON" };
  if (/競合|competitor/i.test(text)) return { kind: "DEEP_RESEARCH", type: "COMPETITOR" };
  if (/支払意思|willingness|払う/i.test(text)) return { kind: "DEEP_RESEARCH", type: "WILLINGNESS_TO_PAY" };
  if (/市場規模|market size/i.test(text)) return { kind: "DEEP_RESEARCH", type: "MARKET_SIZE" };
  if (/規制|regulation|法律/i.test(text)) return { kind: "DEEP_RESEARCH", type: "REGULATION" };
  if (/追加調査|もっと調べ|deep research/i.test(text)) return { kind: "DEEP_RESEARCH", type: "ADDITIONAL" };
  if (/どう思|相談|状況|consult|評価|summary|まとめ/i.test(text)) return { kind: "CONSULT" };
  if (/調べ|探し|探して|調査|research|find|look for/i.test(text) || text.length >= 12) return { kind: "RESEARCH", query: full };
  return { kind: "HELP" };
}
