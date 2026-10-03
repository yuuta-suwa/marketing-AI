import { expect, test } from "@playwright/test";

test("M3: opportunity analyses — competitors, business models, CFO, market size, experiment", async ({ page }) => {
  await page.goto("/research/new");
  await page.getByLabel("何を調べたいですか？").fill("日本の旅行市場で不満を調べる");
  await page.getByRole("button", { name: "調査を開始" }).click();
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", /COMPLETED|PARTIAL_SUCCESS/, { timeout: 30_000 });
  await page.getByTestId("opportunity-card").first().click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]+$/);

  await page.getByRole("button", { name: "Evidenceから競合を分析" }).click();
  await expect(page.getByText(/競合・代替手段 \d+件/)).toBeVisible();

  await page.getByRole("button", { name: "収益モデルを比較（11種）" }).click();
  await expect(page.getByText("11モデルを比較しました")).toBeVisible();
  await expect(page.getByTestId("business-models").locator("li")).toHaveCount(11);

  await page.getByText("前提を入力してCFO分析").click();
  await page.getByLabel("販売価格（月額/顧客）").fill("1200");
  await page.getByRole("button", { name: "CFO分析を実行" }).click();
  await expect(page.getByText(/CFO分析を更新/)).toBeVisible();
  await expect(page.getByTestId("cfo")).toContainText("粗利率");

  const market = page.getByTestId("market-size");
  await market.getByLabel("対象顧客数").fill("1000000");
  await market.getByLabel("年間購入回数").fill("2");
  await market.getByLabel("1回あたり単価").fill("500");
  await market.getByRole("button", { name: "市場規模を計算" }).click();
  await expect(page.getByText(/市場規模: 1,000,000,000 JPY/)).toBeVisible();

  await page.getByText("実験を作成").click();
  const exp = page.getByTestId("experiments");
  await exp.locator('input[name="title"]').fill("LP検証");
  await exp.locator('input[name="method"]').fill("LP + 広告");
  await exp.locator('input[name="metric"]').fill("事前登録率");
  await exp.locator('input[name="target"]').fill("5%");
  await exp.locator('input[name="budgetUsd"]').fill("200");
  await exp.locator('input[name="deadline"]').fill("2026-12-01");
  await exp.getByRole("button", { name: "作成" }).click();
  await expect(page.getByText("実験を作成しました（PROPOSED）")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("experiments")).toContainText("PROPOSED");
});

test("M3: scoring weights are editable and must total 100", async ({ page }) => {
  await page.goto("/settings/scoring");
  await expect(page.getByTestId("weight-total")).toContainText("合計 100");
  await page.getByLabel("痛みの深刻度").fill("20");
  await expect(page.getByTestId("weight-total")).toContainText("合計 105");
  await page.getByRole("button", { name: "重みを保存" }).click();
  await expect(page.getByText(/合計は100/)).toBeVisible();
});
