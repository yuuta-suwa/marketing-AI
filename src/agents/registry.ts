/**
 * Logical AI employees. Each agent is a bounded, single-purpose step invoked
 * by an explicit workflow (never a free-running loop). `maxCallsPerRun` is
 * enforced by AgentRunner.
 */
export type AgentDefinition = {
  name: string;
  role: string;
  status: "ACTIVE" | "PLANNED";
  milestone: string;
};

export const AGENTS: readonly AgentDefinition[] = [
  { name: "MarketDirectorAgent", role: "自然言語の指示をResearch Directiveへ構造化し、ワークフローを指揮", status: "ACTIVE", milestone: "M1" },
  { name: "PainMinerAgent", role: "Evidenceから不満・要望・支払意思などのMarket Signalを抽出", status: "ACTIVE", milestone: "M1" },
  { name: "ClusterNamerAgent", role: "Signal Clusterの命名と要約", status: "ACTIVE", milestone: "M1" },
  { name: "JTBDAnalystAgent", role: "ClusterからJobs-to-be-Done視点で事業機会を構成", status: "ACTIVE", milestone: "M1" },
  { name: "RedTeamAgent", role: "12の問いで事業機会を反証", status: "ACTIVE", milestone: "M1" },
  { name: "JapanScoutAgent", role: "国内ソースの探索計画", status: "PLANNED", milestone: "M2" },
  { name: "GlobalScoutAgent", role: "海外ソースの探索・海外比較", status: "PLANNED", milestone: "M2" },
  { name: "CommerceScoutAgent", role: "EC・マーケットプレイスの公式APIから需要/欠品/価格差を探索", status: "PLANNED", milestone: "M3" },
  { name: "TravelScoutAgent", role: "旅行・ローカル領域の口コミ/混雑/アクセス課題を探索", status: "PLANNED", milestone: "M2" },
  { name: "TicketScoutAgent", role: "チケット・予約領域の需給ギャップ探索", status: "PLANNED", milestone: "M3" },
  { name: "PublicSystemScoutAgent", role: "官公庁統計・制度・規制変更の探索", status: "PLANNED", milestone: "M2" },
  { name: "CompetitorAnalystAgent", role: "直接/間接競合と代替手段の分析", status: "ACTIVE", milestone: "M3" },
  { name: "QuantAnalystAgent", role: "Top-down / Bottom-up / Value Theoryの市場規模計算（根拠付き）", status: "ACTIVE", milestone: "M3" },
  { name: "BusinessModelAgent", role: "収益モデル候補の評価（SaaS偏重を避ける）", status: "ACTIVE", milestone: "M3" },
  { name: "CFOAgent", role: "単価・粗利・CAC・LTV・回収期間をFACT/ASSUMPTION/CALCULATIONで推定", status: "ACTIVE", milestone: "M3" },
  { name: "ComplianceAgent", role: "Connector・データ利用・規制リスクのレビュー", status: "PLANNED", milestone: "M3" },
  { name: "ReporterAgent", role: "Daily Market Brief・レポート生成", status: "PLANNED", milestone: "M3" },
];

export const DEFAULT_MAX_CALLS_PER_AGENT = 12;
