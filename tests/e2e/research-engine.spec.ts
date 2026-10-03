import { expect, test } from "@playwright/test";

test("M2: natural-language research runs through mock connectors to visible market signals", async ({ page }) => {
  await page.goto("/research/new");
  await page.getByLabel("何を調べたいですか？").fill("日本の旅行市場で不満を調べる");
  await page.getByTestId("advanced").locator("summary").click();
  await expect(page.getByLabel("Date Range")).toBeVisible();
  await page.getByRole("button", { name: "調査を開始" }).click();

  await expect(page).toHaveURL(/\/research\/runs\/[0-9a-f-]+$/);
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", /COMPLETED|PARTIAL_SUCCESS/, { timeout: 30_000 });
  await expect(page.getByTestId("connector-runs")).toContainText("web_search");
  await expect(page.getByTestId("connector-runs")).toContainText("estat");
  await expect(page.getByTestId("source-list")).toContainText("MOCK");
  expect(await page.getByTestId("signal-list").locator("li").count()).toBeGreaterThan(3);
  await expect(page.getByText("Estimated Cost")).toBeVisible();
});

test("M2: connector settings show compliance, credentials and admin controls", async ({ page }) => {
  await page.goto("/settings/connectors");
  const list = page.getByTestId("connector-list");
  await expect(list).toContainText("PENDING_REVIEW");
  await expect(list).toContainText("DISABLED_PENDING_COMPLIANCE");
  await expect(list.getByRole("button", { name: "保存" }).first()).toBeVisible();
});
