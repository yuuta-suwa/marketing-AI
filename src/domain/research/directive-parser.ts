import { ResearchDirectiveSchema, type ResearchDirective, type ResearchRequest } from "./directive";

/**
 * Deterministic, dependency-free directive parser. Used when no AI provider is
 * configured and as the fallback when AI output fails validation.
 * It only extracts what is literally present in the input — it never invents
 * markets, personas or numbers.
 */

const COUNTRY_PATTERNS: Array<[RegExp, string]> = [
  [/日本|国内|japan|japanese/i, "JP"],
  [/アメリカ|米国|usa|united states|\bus\b/i, "US"],
  [/イギリス|英国|\buk\b|united kingdom/i, "GB"],
  [/韓国|korea/i, "KR"],
  [/台湾|taiwan/i, "TW"],
  [/中国|china/i, "CN"],
  [/タイ|thailand/i, "TH"],
  [/ベトナム|vietnam/i, "VN"],
  [/シンガポール|singapore/i, "SG"],
  [/ドイツ|germany/i, "DE"],
  [/フランス|france/i, "FR"],
  [/海外|世界|グローバル|global|worldwide/i, "GLOBAL"],
];

const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/旅行|観光|ホテル|宿泊|travel|tourism|hotel/i, "travel"],
  [/飲食|レストラン|グルメ|restaurant|food/i, "food_service"],
  [/チケット|イベント|ライブ|ticket|event|concert/i, "ticketing"],
  [/交通|移動|鉄道|バス|タクシー|transport|mobility/i, "transportation"],
  [/医療|病院|クリニック|health|clinic|hospital/i, "healthcare"],
  [/美容|サロン|beauty|salon/i, "beauty"],
  [/介護|育児|子育て|care|childcare|parenting/i, "care"],
  [/ec|通販|ショッピング|commerce|shopping|marketplace/i, "commerce"],
  [/求人|採用|人手不足|hiring|recruit|labor/i, "labor"],
  [/行政|自治体|補助金|制度|規制|government|regulation|subsidy/i, "public_sector"],
  [/saas|業務|バックオフィス|dx|b2b/i, "b2b_operations"],
  [/教育|学習|education|learning/i, "education"],
  [/不動産|住宅|real estate|housing/i, "real_estate"],
  [/金融|保険|finance|insurance|fintech/i, "finance"],
];

const PERSONA_PATTERNS: Array<[RegExp, string]> = [
  [/訪日|インバウンド|外国人観光客|inbound/i, "inbound tourists"],
  [/高齢者|シニア|elderly|senior/i, "seniors"],
  [/子育て|親|parents?/i, "parents"],
  [/学生|students?/i, "students"],
  [/中小企業|smb|small business/i, "small businesses"],
  [/フリーランス|freelancer/i, "freelancers"],
  [/利用者|ユーザー|消費者|customers?|users?|consumers?/i, "end users"],
];

const PAIN_TERMS_JA = ["不満", "不便", "困っ", "不安", "要望"];
const STOPWORDS = new Set([
  "から", "して", "探して", "ください", "こと", "ため", "について", "新規事業", "事業", "機会",
  "市場", "探す", "find", "the", "and", "for", "from", "with", "market", "business", "new",
  "opportunity", "opportunities", "please",
]);

function matchAll(input: string, patterns: Array<[RegExp, string]>): string[] {
  const out: string[] = [];
  for (const [re, value] of patterns) if (re.test(input) && !out.includes(value)) out.push(value);
  return out;
}

export function detectLanguage(input: string): "ja" | "en" {
  return /[぀-ヿ一-鿿]/.test(input) ? "ja" : "en";
}

export function extractKeywords(input: string): string[] {
  const cleaned = input.replace(/[、。,.!?！？「」『』（）()\[\]【】:：;；"'`]/g, " ");
  const tokens = new Set<string>();
  // Japanese: split on particles and common verb endings, keep 2+ char chunks.
  for (const chunk of cleaned.split(/\s+|の|で|を|に|が|は|と|や|から|まで|より|へ|して|する|した/)) {
    const t = chunk.trim().toLowerCase();
    if (t.length >= 2 && t.length <= 30 && !STOPWORDS.has(t)) tokens.add(t);
  }
  return [...tokens].slice(0, 20);
}

export function parseDirectiveByRules(request: ResearchRequest): ResearchDirective {
  const input = request.input.trim();
  const language = detectLanguage(input);
  const countries = matchAll(input, COUNTRY_PATTERNS);
  const keywords = extractKeywords(input);
  for (const term of PAIN_TERMS_JA) if (input.includes(term) && !keywords.includes(term)) keywords.push(term);

  return ResearchDirectiveSchema.parse({
    rawInput: input,
    objective: input.slice(0, 500),
    countries: request.countries?.length ? request.countries : countries.length > 0 ? countries : language === "ja" ? ["JP"] : [],
    languages: request.languages?.length ? request.languages : [language],
    personas: matchAll(input, PERSONA_PATTERNS),
    categories: matchAll(input, CATEGORY_PATTERNS),
    keywords: keywords.slice(0, 40),
    negativeKeywords: [],
    timeRange: { preset: request.timeRangePreset ?? "90d" },
    sourcePreferences: request.sourcePreferences ?? [],
    maxItems: request.maxItems ?? 50,
    budgetLimitUsd: request.budgetLimitUsd ?? 0.5,
    deepResearch: request.deepResearch ?? false,
  });
}
