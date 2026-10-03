import { expect, test } from "@playwright/test";

async function seedOpportunity(page: import("@playwright/test").Page) {
  await page.goto("/research/new");
  await page.getByLabel("何を調べたいですか？").fill("日本の旅行市場で不満を調べる");
  await page.getByRole("button", { name: "調査を開始" }).click();
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", /COMPLETED|PARTIAL_SUCCESS/, { timeout: 30_000 });
  await page.getByTestId("opportunity-card").first().click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]+$/);
  return page.url().split("/").pop()!;
}

test("M4: FRIDAY command center — context, council, CEO approvals, PoC spec, export gate, decision memory", async ({ page }) => {
  const id = await seedOpportunity(page);
  await page.goto(`/friday?opportunity=${id}`);
  const fridaySays = async (text: string, expectText: RegExp) => {
    await page.getByLabel("FRIDAYへの指示").fill(text);
    await page.getByRole("button", { name: "送信" }).click();
    await expect(page.getByTestId("friday-console").locator('[data-role="friday"]').last()).toContainText(expectText);
  };

  await fridaySays("顧問会議", /顧問会議/);
  await page.reload();
  await expect(page.getByTestId("council")).toContainText("Capital Efficiency");
  await expect(page.getByTestId("council")).toContainText("Required Evidence");

  await fridaySays("承認 理由: 証拠を確認", /承認を記録しました/);
  await fridaySays("承認", /実験提案/);
  await fridaySays("承認", /実験承認/);
  await fridaySays("Claude Codeにエクスポート", /PoC承認/);
  await fridaySays("PoC仕様書", /PoC仕様書を作成しました/);
  await page.getByRole("link", { name: "仕様書を開く →" }).click();
  await expect(page.getByTestId("report-content")).toContainText("## Acceptance Criteria");
  await expect(page.getByTestId("report-content")).toContainText("DRAFT");

  await page.goto(`/friday?opportunity=${id}`);
  await fridaySays("承認 理由: CEOとしてPoC開始を承認", /PoC承認/);
  await fridaySays("Claude Codeにエクスポート", /CLAUDE_CODE_BUILD_PROMPT/);
  await page.getByRole("link", { name: "プロンプトを開く →" }).click();
  await expect(page.getByTestId("report-content")).toContainText("# CLAUDE_CODE_BUILD_PROMPT");
  const download = await page.request.get(page.url().replace("/reports/", "/api/reports/") + "/download");
  expect(download.headers()["content-disposition"]).toContain("CLAUDE_CODE_BUILD_PROMPT.md");

  await page.goto(`/friday?opportunity=${id}`);
  await expect(page.getByTestId("decision-memory")).toContainText("CEOとしてPoC開始を承認");
  await expect(page.getByTestId("decision-memory")).toContainText("FRIDAY");
});

test("M4: watchlist, daily brief and feedback loop", async ({ page }) => {
  const id = await seedOpportunity(page);

  await page.getByLabel("指標").selectOption("REVENUE");
  await page.getByLabel("数値").fill("120000");
  await page.getByLabel("単位").fill("JPY");
  await page.getByRole("button", { name: "結果を記録" }).click();
  await expect(page.getByText("結果を記録しました")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("feedback-list")).toContainText("REVENUE 120000 JPY");

  await page.goto("/watchlists");
  await page.getByLabel("監視キーワード").fill("空港");
  await page.getByRole("button", { name: "ウォッチに追加" }).click();
  await expect(page.getByText(/ウォッチを追加しました/)).toBeVisible();
  await page.getByLabel("監視対象").selectOption("OPPORTUNITY");
  await page.getByLabel("監視する事業機会").selectOption(id);
  await page.getByRole("button", { name: "ウォッチに追加" }).click();
  await page.getByRole("button", { name: /今すぐチェック/ }).click();
  await expect(page.getByText(/件をチェック/)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("watchlist").locator("li")).toHaveCount(2);

  await page.goto("/dashboard");
  await expect(page.getByTestId("daily-brief")).toContainText("新規シグナル");

  const csv = await page.request.get("/api/feedback/export");
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain("120000");
});

test("M4: cron endpoints reject requests without the secret", async ({ request }) => {
  expect((await request.get("/api/cron/monitor")).status()).toBe(401);
  expect((await request.get("/api/cron/daily-brief", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
});
