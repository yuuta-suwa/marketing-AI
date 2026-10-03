import { BUSINESS_MODEL_TYPES, type BusinessModelType } from "../opportunity/business-model";
import type { SignalType } from "../signal/signal";

export const BUSINESS_MODEL_LABEL_JA: Record<BusinessModelType, string> = {
  SUBSCRIPTION: "サブスクリプション",
  TRANSACTION_FEE: "取引手数料",
  MARKETPLACE_COMMISSION: "マーケットプレイス手数料",
  LEAD_GENERATION: "送客・リード獲得",
  ADVERTISING: "広告",
  LICENSING: "ライセンス",
  DATA_PRODUCT: "データ商品",
  SERVICE: "サービス（人手）",
  B2B_SAAS: "B2B SaaS",
  CONSUMER_APP: "コンシューマーアプリ",
  HYBRID: "ハイブリッド",
};

export type BusinessModelContext = {
  signalTypes: SignalType[];
  /** Persona/customer text — used only to detect B2B vs consumer wording. */
  customerText: string;
  paySignalScore: number;
  signalCount: number;
};

export type BusinessModelAssessment = {
  modelType: BusinessModelType;
  fitScore: number;
  rationale: string;
  risks: string;
};

const B2B = /企業|事業者|法人|中小|店舗|ホテル|旅館|自治体|b2b|business|company|smb|operator|merchant/i;

/**
 * Rule-based comparison of ALL model types (never defaulting to SaaS).
 * Output is a HYPOTHESIS ranking with an explicit rationale per model.
 */
export function compareBusinessModels(ctx: BusinessModelContext): BusinessModelAssessment[] {
  const n = (t: SignalType) => ctx.signalTypes.filter((x) => x === t).length;
  const share = (t: SignalType) => (ctx.signalTypes.length ? n(t) / ctx.signalTypes.length : 0);
  const b2b = B2B.test(ctx.customerText);
  const pay = ctx.paySignalScore / 100;
  const volume = Math.min(1, ctx.signalCount / 20);

  const score = (base: number, reasons: Array<[boolean, number, string]>, risks: string) => {
    let s = base;
    const why: string[] = [];
    for (const [cond, delta, reason] of reasons) {
      if (cond) {
        s += delta;
        why.push(reason);
      }
    }
    return { fit: Math.round(Math.max(0, Math.min(100, s))), rationale: why.join(" / ") || "特筆すべき適合シグナルなし", risks };
  };

  const table: Record<BusinessModelType, ReturnType<typeof score>> = {
    SUBSCRIPTION: score(35, [[n("WORKAROUND") > 0, 15, "継続的な代替行動あり（繰り返し課題）"], [pay > 0.5, 15, "支払意思シグナル"], [share("PAIN") > 0.3, 5, "恒常的な不満"]], "解約率・継続価値の証明が必要"),
    TRANSACTION_FEE: score(30, [[n("CAPACITY_GAP") + n("SHORTAGE") > 0, 25, "需給ギャップ（予約・在庫）"], [n("PRICE_GAP") > 0, 10, "価格差の存在"], [pay > 0.4, 10, "都度課金への支払意思"]], "取引量が少ないと収益化しない"),
    MARKETPLACE_COMMISSION: score(25, [[n("SHORTAGE") + n("CAPACITY_GAP") + n("DISTRIBUTION_GAP") > 1, 25, "供給と需要のマッチング課題"], [volume > 0.5, 10, "シグナル量が多い"]], "鶏と卵（供給側獲得）問題"),
    LEAD_GENERATION: score(25, [[n("INFORMATION_GAP") > 0, 20, "情報不足 → 送客価値"], [n("TRUST_GAP") > 0, 10, "比較・信頼の仲介価値"]], "送客先事業者の獲得と単価が不確実"),
    ADVERTISING: score(15, [[volume > 0.7, 15, "大量の利用者接点が見込める"], [n("INFORMATION_GAP") > 0, 10, "情報メディア化の余地"]], "規模が出るまで収益が小さい"),
    LICENSING: score(10, [[b2b && n("REGULATION_GAP") > 0, 15, "制度対応ノウハウのライセンス"]], "知財・ノウハウの独自性が必要"),
    DATA_PRODUCT: score(15, [[volume > 0.6, 15, "集約データ自体に価値"], [b2b, 10, "事業者向けインサイト需要"]], "データ利用許諾・プライバシー"),
    SERVICE: score(30, [[n("REGULATION_GAP") > 0, 20, "手続き代行ニーズ"], [n("TRUST_GAP") > 0, 10, "人による安心感"], [pay > 0.5, 10, "支払意思"]], "人手依存で粗利が低くスケールしにくい"),
    B2B_SAAS: score(20, [[b2b, 30, "顧客が事業者"], [n("WORKAROUND") > 0 && b2b, 15, "業務の代替手段（Excel等）"]], "営業コスト（CAC）が高い"),
    CONSUMER_APP: score(25, [[!b2b, 20, "個人顧客の課題"], [n("ANXIETY") + n("INFORMATION_GAP") > 0, 10, "情報・安心提供"]], "個人向けはCACと継続率が課題"),
    HYBRID: score(20, [[b2b && n("CAPACITY_GAP") + n("SHORTAGE") > 0, 20, "事業者SaaS＋取引手数料の組合せ"]], "複雑化による実行難度"),
  };
  return BUSINESS_MODEL_TYPES.map((t) => ({ modelType: t, fitScore: table[t].fit, rationale: table[t].rationale, risks: table[t].risks })).sort(
    (a, b) => b.fitScore - a.fitScore,
  );
}
