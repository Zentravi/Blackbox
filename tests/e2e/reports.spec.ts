import { expect, test } from "@playwright/test";
import { freshScenario } from "./helpers";

test.describe("reports", () => {
  test("report list shows incidents and opens a full report", async ({ page }) => {
    await freshScenario(page, /Database connection exhaustion/i);
    await page.goto("/reports");

    // Resolved historical incidents are present with outcome badges.
    const reportLink = page.locator('a[href^="/reports/inc-"]').first();
    await expect(reportLink).toBeVisible();
    await reportLink.click();
    await page.waitForURL(/\/reports\/inc-/);

    // The report document has all of its sections.
    for (const section of [
      /Incident summary/i,
      /Impact/i,
      /Root cause analysis/i,
      /Timeline/i,
      /Recovery actions/i,
      /Outcome/i,
      /Lessons/i,
    ]) {
      await expect(page.getByText(section).first(), `section ${section}`).toBeVisible();
    }
  });

  test("markdown export downloads a file", async ({ page }) => {
    await page.goto("/reports");
    await page.locator('a[href^="/reports/inc-"]').first().click();
    await page.waitForURL(/\/reports\/inc-/);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Markdown/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/-report\.md$/);
  });

  test("reports survive scenario switches (history is archived)", async ({ page }) => {
    await freshScenario(page, /Database connection exhaustion/i);
    await page.goto("/reports");
    const before = await page.locator('a[href^="/reports/inc-"]').count();
    expect(before).toBeGreaterThan(0);

    // Switch scenario — previous run's incidents stay reportable.
    await freshScenario(page, /Cascading service failure/i);
    await page.goto("/reports");
    const after = await page.locator('a[href^="/reports/inc-"]').count();
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
