import type { SignalType } from "@/domain/signal/signal";

/**
 * Lexical cues per signal type (Japanese + English). Deliberately conservative:
 * a heuristic signal is only created when the evidence literally contains a cue.
 */
export const SIGNAL_CUES: Record<SignalType, RegExp> = {
  PAIN: /不満|不便|困って|困る|困った|面倒|めんどう|最悪|ひどい|酷い|使いにくい|使いづらい|分かりにくい|わかりにくい|ストレス|イライラ|frustrat|annoying|terrible|awful|painful|hate|difficult|confusing|hassle/i,
  ANXIETY: /不安|心配|怖い|こわい|大丈夫かな|worr(y|ied)|anxious|afraid|nervous|unsure/i,
  REQUEST: /ほしい|欲しい|あったらいい|あればいい|してほしい|して欲しい|対応してほしい|改善してほしい|wish|would love|please add|i want|we need|should (have|offer)/i,
  SHORTAGE: /足りない|不足|品切れ|欠品|売り切れ|在庫がない|手薄|sold out|out of stock|shortage|not enough/i,
  WORKAROUND: /仕方なく|しかたなく|自分で|代わりに|手作業|エクセル|excel|スプレッドシート|spreadsheet|workaround|instead,? i|manually|ended up/i,
  SWITCHING: /乗り換え|乗換|解約|やめた|辞めた|他社|別のサービス|switch(ed|ing)?|cancel(l)?ed|moving to|migrat/i,
  PAY_SIGNAL: /払ってもいい|払っても良い|お金を払|有料でも|課金して|お金を出して|would pay|happy to pay|worth paying|pay for/i,
  PRICE_GAP: /高い|高すぎ|値上げ|割高|高額|ぼったくり|expensive|overpriced|too much money|price (hike|increase)|pricey/i,
  ACCESS_GAP: /行けない|遠い|アクセスが悪|地方では|対応していない地域|使えない地域|hard to reach|no access|not available in|far from/i,
  TRUST_GAP: /信用でき|信頼でき|詐欺|怪しい|やらせ|サクラ|口コミが信用|trust|scam|fake review|sketchy/i,
  INFORMATION_GAP: /分からない|わからない|情報がない|情報が少ない|知らなかった|案内がない|説明がない|英語(の|が)?(案内|表記)|unclear|no information|couldn'?t find|no idea how/i,
  DISTRIBUTION_GAP: /売っていない|売ってない|手に入らない|取り扱いがない|取扱いがない|どこで買え|not sold|can'?t buy|unavailable/i,
  CAPACITY_GAP: /待ち時間|待たされ|行列|混雑|満席|予約が取れない|予約できない|順番待ち|long wait|waited|queue|crowded|fully booked|no availability/i,
  REGULATION_GAP: /規制|法律|許可|許認可|制度|手続き|申請|書類|regulation|permit|license|paperwork|red tape|compliance/i,
};

export const INTENSITY_CUES = /本当に|ほんとに|すごく|かなり|最悪|絶対|二度と|!!|！！|really|extremely|so (bad|annoying)|never again/i;
export const FREQUENCY_CUES = /毎回|いつも|毎日|毎週|しょっちゅう|何度も|頻繁|always|every time|every day|constantly|again and again/i;

/** Evidence excerpts with no cue at all are not signals. */
export function detectSignalTypes(text: string): SignalType[] {
  return (Object.entries(SIGNAL_CUES) as Array<[SignalType, RegExp]>)
    .filter(([, re]) => re.test(text))
    .map(([t]) => t);
}

export function hasAnyCue(text: string): boolean {
  return detectSignalTypes(text).length > 0;
}

/** Priority used to pick the primary type when several cues match. */
export const SIGNAL_PRIORITY: SignalType[] = [
  "PAY_SIGNAL",
  "SWITCHING",
  "WORKAROUND",
  "SHORTAGE",
  "CAPACITY_GAP",
  "PRICE_GAP",
  "TRUST_GAP",
  "ACCESS_GAP",
  "DISTRIBUTION_GAP",
  "REGULATION_GAP",
  "INFORMATION_GAP",
  "REQUEST",
  "ANXIETY",
  "PAIN",
];
