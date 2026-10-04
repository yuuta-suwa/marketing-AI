# MARKET RADAR OS

公開情報に現れる **不満・不安・不便・要望・欠品・価格差・待ち時間・信頼不足・代替行動・乗換意向・支払意思・制度変更** を収集し、
**証拠付きの事業機会** に変換する AI 市場インテリジェンス OS。

```
SOURCE → EVIDENCE → SIGNAL → CLUSTER → OPPORTUNITY → BUSINESS MODEL → MARKET VALIDATION → CFO
       → RED TEAM → FRIDAY → ADVISOR COUNCIL → HUMAN DECISION → EXPERIMENT → PoC → CLAUDE CODE BUILD
```
v0.1.0 で全工程（競合・市場規模・CFO・顧問会議・PoC・Claude Code Export を含む）を実装済み。詳細は [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)。

## 原則

Evidence First · Mobile First · API First · Provider Agnostic · Human Approval · Compliance by Design ·
Security by Design · Cost Awareness · No Hallucinated Market Facts · Traceability · Reproducibility · Explainability

- Evidence は **ソース本文の逐語引用** のみ（DB トリガーで強制）。
- AI 出力は `FACT / INFERENCE / HYPOTHESIS / ASSUMPTION / CALCULATION` を明示して保存。
- 市場規模を AI だけで生成しない。根拠のない数値は「未推定」と表示。
- **Score（魅力度）と Confidence（証拠の強さ）は別軸**。
- PoC 以降の承認は人間の判断（`decisions`）が DB レベルで必須。

## Quick start

```bash
npm ci
cp .env.example .env.local

# A) ローカルデモ（Supabase なし・本番利用不可、モックConnector付き）
printf "MRO_DEMO_MODE=true\nCONNECTOR_MOCK_MODE=true\n" >> .env.local
npm run dev            # http://localhost:3000

# B) Supabase
#   supabase/migrations/*.sql を適用し、NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY を設定
```

詳細: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Scripts

| Command | 内容 |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen` + `tsc --noEmit`（strict） |
| `npm test` | Vitest（unit + integration、外部通信なし） |
| `npm run test:db` | 一時 PostgreSQL + pgvector にマイグレーション適用、RLS/整合性テスト |
| `npm run test:e2e` | Playwright（モバイルビューポート、デモモードの本番ビルド） |

## Docs

[ARCHITECTURE](docs/ARCHITECTURE.md) · [DATABASE](docs/DATABASE.md) · [DOMAIN_MODEL](docs/DOMAIN_MODEL.md) ·
[AGENTS](docs/AGENTS.md) · [CONNECTORS](docs/CONNECTORS.md) · [COMPLIANCE](docs/COMPLIANCE.md) ·
[SECURITY](docs/SECURITY.md) · [FRIDAY_INTEGRATION](docs/FRIDAY_INTEGRATION.md) · [DEPLOYMENT](docs/DEPLOYMENT.md) ·
[TESTING](docs/TESTING.md) · [IMPLEMENTATION_STATUS](docs/IMPLEMENTATION_STATUS.md) · Handoffs [M1](docs/HANDOFF_M1.md) [M2](docs/HANDOFF_M2.md) [M3](docs/HANDOFF_M3.md) [M4](docs/HANDOFF_M4.md) · [RELEASE v0.1.0](docs/RELEASE_v0.1.0.md)
