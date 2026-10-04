import { expect, test } from "@playwright/test";

const ROUTES: Array<[string, RegExp]> = [
  ["/dashboard", /Market Radar/],
  ["/research/new", /新規調査/],
  ["/research/runs", /調査履歴/],
  ["/opportunities", /事業機会/],
  ["/signals", /Market Signals/],
  ["/clusters", /Signal Clusters/],
  ["/friday", /FRIDAY Command Center/],
  ["/watchlists", /Watchlists/],
  ["/reports", /Reports/],
  ["/settings/connectors", /Connectors/],
  ["/settings/scoring", /Scoring/],
  ["/settings/costs", /Costs/],
  ["/settings/security", /Security/],
  ["/settings/observability", /Observability/],
];

for (const [path, heading] of ROUTES) {
  test(`renders ${path} without horizontal overflow`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test("empty states and navigation are present", async ({ page }) => {
  await page.goto("/watchlists");
  await expect(page.getByRole("navigation", { name: "メイン" })).toBeVisible();
});
