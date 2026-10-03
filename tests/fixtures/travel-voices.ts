import type { RawSourceItem } from "@/domain/source/source-item";

/**
 * TEST FIXTURE — synthetic customer-voice texts written for automated tests.
 * Not real market evidence; never loaded by the application at runtime.
 */
export const TRAVEL_VOICES: RawSourceItem[] = [
  { sourceType: "MANUAL", sourceName: "Interview notes A", body: "空港からホテルまでの移動手段が分かりにくい。毎回タクシーに高いお金を払っている。", publishedAt: "2026-09-20T00:00:00Z", country: "JP", language: "ja" },
  { sourceType: "MANUAL", sourceName: "Interview notes A", body: "空港の乗り換え案内が分かりにくい。英語の案内も少なくて本当に困った。", publishedAt: "2026-09-21T00:00:00Z", country: "JP", language: "ja" },
  { sourceType: "MANUAL", sourceName: "Survey B", body: "空港から市内への移動が分かりにくい。乗り換えが複雑で毎回迷う。", publishedAt: "2026-09-25T00:00:00Z", country: "JP", language: "ja" },
  { sourceType: "MANUAL", sourceName: "Survey B", body: "コインロッカーが足りない。駅のロッカーはいつも満杯で、荷物を預けられず困っている。", publishedAt: "2026-09-10T00:00:00Z", country: "JP", language: "ja" },
  { sourceType: "MANUAL", sourceName: "Support inbox C", body: "駅のコインロッカーが足りない。大きなスーツケースを預ける場所がなく、仕方なくカフェに長居した。", publishedAt: "2026-09-12T00:00:00Z", country: "JP", language: "ja" },
  { sourceType: "MANUAL", sourceName: "Survey B", body: "荷物を預ける場所が足りない。有料でもいいので荷物を預かってほしい。", publishedAt: "2026-09-28T00:00:00Z", country: "JP", language: "ja" },
  { sourceType: "MANUAL", sourceName: "Interview notes A", body: "人気の旅館は予約が取れない。キャンセル待ちも行列で、結局別の宿に乗り換えた。", publishedAt: "2026-08-15T00:00:00Z", country: "JP", language: "ja" },
  { sourceType: "MANUAL", sourceName: "Support inbox C", body: "週末の旅館は満席で予約が取れない。空きが出たら通知してほしい。お金を払ってもいい。", publishedAt: "2026-09-02T00:00:00Z", country: "JP", language: "ja" },
  { sourceType: "MANUAL", sourceName: "Survey B", body: "旅館の予約が取れない。予約サイトを毎日チェックしているが空きが出ない。", publishedAt: "2026-09-29T00:00:00Z", country: "JP", language: "ja" },
  { sourceType: "MANUAL", sourceName: "Survey B", body: "とても楽しい旅行でした。景色がきれいでした。", publishedAt: "2026-09-29T00:00:00Z", country: "JP", language: "ja" },
  // exact duplicate of the first item (different whitespace / punctuation)
  { sourceType: "MANUAL", sourceName: "Interview notes A", body: "空港からホテルまでの移動手段が分かりにくい 毎回タクシーに高いお金を払っている", publishedAt: "2026-09-20T00:00:00Z", country: "JP", language: "ja" },
];
