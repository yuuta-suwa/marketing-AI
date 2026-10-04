import { expect, test } from "@playwright/test";

test("Phase 5: research is queued, the worker runs it, progress reaches 100% and MOCK is always visible", async ({ page }) => {
  await page.goto("/research/new");
  await expect(page.getByTestId("mock-badge")).toBeVisible();
  await page.getByLabel("何を調べたいですか？").fill("日本の旅行市場で、利用者が感じている不満・不便・不足から新規事業機会を探して");
  await page.getByRole("button", { name: "調査を開始" }).click();

  // The request returns immediately with the run page; the work happens in the background.
  await expect(page).toHaveURL(/\/research\/runs\/[0-9a-f-]+$/);
  await expect(page.getByTestId("run-progress")).toBeVisible();
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", /COMPLETED|PARTIAL_SUCCESS/, { timeout: 30_000 });
  await expect(page.getByTestId("run-progress")).toHaveAttribute("data-percent", "100");
  await expect(page.getByTestId("run-jobs")).toContainText("データ収集");
  await expect(page.getByTestId("run-jobs")).toContainText("事業機会の生成・評価");
  await expect(page.locator("[data-job-status=COMPLETED]")).toHaveCount(4);
  await expect(page.getByTestId("mock-badge")).toBeVisible();
});

test("Phase 5: connector status shows mode, readiness, usage; health endpoint reports mock mode", async ({ page, request }) => {
  await page.goto("/settings/connectors");
  const modes = page.getByTestId("connector-mode");
  await expect(modes.first()).toBeVisible();
  await expect(page.locator("[data-testid=connector-mode][data-mode=MOCK]").first()).toBeVisible();
  await expect(page.getByTestId("connector-list")).toContainText("本日のリクエスト");
  await expect(page.getByTestId("connector-list")).toContainText("最終成功");

  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  const body = await health.json();
  expect(body).toMatchObject({ ok: true, mode: "demo", mockConnectors: true, configErrors: 0 });
  expect(JSON.stringify(body)).not.toMatch(/KEY|SECRET|TOKEN/);

  await page.goto("/settings/observability");
  await expect(page.getByTestId("job-list")).toBeVisible();
});

test("Phase 6: a member records a human quality review (system never fills it)", async ({ page, request }) => {
  await page.goto("/research/new");
  await page.getByLabel("何を調べたいですか？").fill("日本の旅行市場で、旅行者の不満から事業機会を調べる");
  await page.getByRole("button", { name: "調査を開始" }).click();
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", /COMPLETED|PARTIAL_SUCCESS/, { timeout: 30_000 });
  const review = page.getByTestId("quality-review");
  await expect(review).toBeVisible();
  const first = review.locator("form").first();
  await expect(first.getByLabel("Human rating")).toHaveValue(""); // empty until a human rates it
  await first.getByLabel("Human rating").selectOption("4");
  await first.getByLabel("Human decision").selectOption("DEEP_DIVE");
  await first.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("評価を保存しました")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("quality-review").locator("form").first().getByLabel("Human rating")).toHaveValue("4");

  const health = await (await request.get("/api/health")).json();
  expect(health).toMatchObject({ appEnv: "staging", productionMockOverride: false });
});
