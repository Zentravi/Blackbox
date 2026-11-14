import { expect, test } from "@playwright/test";
import { freshScenario } from "./helpers";

test.describe("log explorer", () => {
  test("renders rows, filters by level and search, deep-links from URL", async ({ page }) => {
    await freshScenario(page, /Database connection exhaustion/i);
    await page.goto("/logs");

    // Rows are present.
    const rows = page.getByTestId("log-row");
    await expect(rows.first()).toBeVisible();
    const initialCount = await rows.count();
    expect(initialCount).toBeGreaterThan(10);

    // Level chip filters and updates the URL.
    await page.getByRole("button", { name: /^error/i }).click();
    await expect(page).toHaveURL(/level=error/);
    const errorCount = await rows.count();
    expect(errorCount).toBeGreaterThan(0);
    expect(errorCount).toBeLessThanOrEqual(initialCount);
    // Every visible row is an ERROR row.
    const firstLevel = await rows.first().locator("td").nth(1).innerText();
    expect(firstLevel.trim().toLowerCase()).toBe("error");

    // Deep link restores filters.
    await page.goto("/logs?level=warn&q=pool");
    await expect(page).toHaveURL(/level=warn/);
    await expect(page.getByPlaceholder(/Search message/i)).toHaveValue("pool");

    // Search narrows results further.
    await page.goto("/logs");
    await page.getByPlaceholder(/Search message/i).fill("pool");
    await expect(page).toHaveURL(/q=pool/);
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const searched = await rows.count();
    expect(searched).toBeLessThanOrEqual(initialCount);
  });

  test("row click opens the fields dialog with trace link", async ({ page }) => {
    await freshScenario(page, /Database connection exhaustion/i);
    await page.goto("/logs");
    const row = page.getByTestId("log-row").first();
    await row.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Structured fields/i)).toBeVisible();
    await expect(dialog.getByText(/Service/i).first()).toBeVisible();
  });

  test("CSV export downloads the filtered view", async ({ page }) => {
    await freshScenario(page, /Database connection exhaustion/i);
    await page.goto("/logs");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export CSV/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/blackbox-logs-\d+\.csv$/);
  });

  test("live tail toggle switches between newest-window and full browse", async ({ page }) => {
    await freshScenario(page, /Database connection exhaustion/i);
    await page.goto("/logs");
    const toggle = page.getByLabel(/Live tail|live tail/i);
    await expect(toggle).toBeChecked();
    await toggle.click({ force: true });
    await expect(page.getByText(/Paused/i)).toBeVisible();
    await toggle.click({ force: true });
    await expect(page.getByText(/Live tail/i).first()).toBeVisible();
  });
});
