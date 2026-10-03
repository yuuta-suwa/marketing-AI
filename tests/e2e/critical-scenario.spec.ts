import { expect, test } from "@playwright/test";

// TEST FIXTURE — synthetic voices typed into the manual import box.
const MANUAL = [
  "source: Interview A\n空港からホテルまでの移動手段が分かりにくい。毎回タクシーに高いお金を払っている。",
  "source: Survey B\n空港の乗り換え案内が分かりにくい。英語の案内も少なくて本当に困った。",
  "source: Survey B\n空港から市内への移動が分かりにくい。乗り換えが複雑で毎回迷う。",
  "source: Survey B\nコインロッカーが足りない。駅のロッカーはいつも満杯で、荷物を預けられず困っている。",
  "source: Inbox C\n駅のコインロッカーが足りない。大きなスーツケースを預ける場所がなく、仕方なくカフェに長居した。",
  "source: Survey B\n荷物を預ける場所が足りない。有料でもいいので荷物を預かってほしい。",
  "source: Interview A\n人気の旅館は予約が取れない。キャンセル待ちも行列で、結局別の宿に乗り換えた。",
  "source: Inbox C\n週末の旅館は満席で予約が取れない。空きが出たら通知してほしい。お金を払ってもいい。",
  "source: Survey B\n旅館の予約が取れない。予約サイトを毎日チェックしているが空きが出ない。",
].join("\n\n");

test("mobile critical scenario: research → opportunities → evidence → red team → additional research → FRIDAY → decision", async ({ page }) => {
  // 1. Login (demo mode signs in the demo user)
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("demo-banner")).toBeVisible();

  // 2. Research input
  await page.goto("/research/new");
  await page.getByLabel("何を調べますか？").fill("旅行市場の不満から新規事業を探す");
  await page.locator('textarea[name="manual"]').fill(MANUAL);
  await page.getByRole("button", { name: "調査を開始" }).click();

  // 3-8. Run created and pipeline completes
  await expect(page).toHaveURL(/\/research\/runs\/[0-9a-f-]+$/);
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "COMPLETED", { timeout: 30_000 });
  await expect(page.getByTestId("connector-runs")).toContainText("manual_import");
  const cards = page.getByTestId("opportunity-card");
  expect(await cards.count()).toBeGreaterThanOrEqual(3);

  // 9. Opportunity detail
  await cards.first().click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]+$/);
  await expect(page.getByText("Score Breakdown")).toBeVisible();

  // 10. Evidence is visible and quoted
  const evidence = page.getByTestId("evidence-list").locator("li");
  expect(await evidence.count()).toBeGreaterThan(0);
  await expect(evidence.first()).toContainText("「");

  // 11. Red Team
  await page.getByRole("button", { name: "Red Teamを実行" }).click();
  await expect(page.getByText(/Red Team完了/)).toBeVisible();
  await expect(page.getByTestId("red-team-findings").locator("li")).toHaveCount(12);

  // 13. FRIDAY consult
  await page.getByRole("button", { name: "FRIDAYに相談" }).click();
  await expect(page.getByTestId("friday-briefing")).toContainText("推奨アクション");

  // 14. Decision saved
  const opportunityUrl = page.url();
  await page.locator('textarea[name="rationale"]').fill("支払意思の証拠が弱いため保留");
  await page.getByRole("button", { name: "保留" }).click();
  await expect(page.getByText(/判断を記録しました/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("decision-log")).toContainText("HOLD");

  // 12. Additional research creates a linked run
  await page.goto(opportunityUrl);
  await page.locator("#ar-type").selectOption("WILLINGNESS_TO_PAY");
  await page.getByRole("button", { name: "追加調査を開始" }).click();
  await expect(page).toHaveURL(/\/research\/runs\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expect(page.getByText("元の事業機会へ戻る")).toBeVisible();
});

test("PWA manifest and security headers", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe("standalone");
  const res = await request.get("/login");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});

test("unknown ids return 404 instead of leaking data", async ({ page }) => {
  const res = await page.goto("/opportunities/00000000-0000-4000-8000-000000000000");
  expect(res?.status()).toBe(404);
});
