import { expect, test } from "@playwright/test";
import { freshScenario } from "./helpers";

test.describe("investigation flow", () => {
  test("correlation analysis ranks hypotheses and verifies the root cause", async ({ page }) => {
    await freshScenario(page, /Database connection exhaustion/i);

    // Deep-link straight to the active incident's analysis context.
    await page.goto("/investigate?incident=inc-1042");
    await expect(page.getByText(/INC-1042/i).first()).toBeVisible();

    // Run the analysis (engine has a short deliberate "correlating" delay).
    await page.getByRole("button", { name: /Run correlation analysis|Re-run analysis/i }).first().click();
    const topCard = page.locator("[data-testid=hypothesis-card]").first();
    await expect(topCard).toBeVisible({ timeout: 20_000 });
    await expect(topCard).toContainText(/confidence/i);

    // Record the top-ranked hypothesis as the root cause.
    await topCard.getByRole("button", { name: /Set as root cause/i }).click();
    await expect(page.getByText(/Root cause recorded/i)).toBeVisible();

    // Resolve the same incident from the Incident Center.
    await page.goto("/incidents");
    await page.locator('a[href="/incidents/inc-1042"]').first().click();
    await page.waitForURL(/\/incidents\/inc-1042/);
    await page.getByRole("button", { name: /^Resolve$/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("Pool resized and verified — recovered.");
    await dialog.getByRole("button", { name: "Mark resolved" }).click();
    await expect(page.getByText(/resolved/i).first()).toBeVisible();

    // Back on the investigation page the answer is revealed and verified.
    // (Analysis results are per-visit state — re-run to render the cards.)
    await page.goto("/investigate?incident=inc-1042");
    await page
      .getByRole("button", { name: /Run correlation analysis|Re-run analysis/i })
      .first()
      .click();
    await expect(page.getByText("Your RC").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Verified: your root cause matches/i).first()).toBeVisible();
  });

  test("analysis produces evidence deep links that navigate", async ({ page }) => {
    await freshScenario(page, /Database connection exhaustion/i);
    await page.goto("/investigate?incident=inc-1042");
    await page.getByRole("button", { name: /Run correlation analysis/i }).first().click();
    const topCard = page.locator("[data-testid=hypothesis-card]").first();
    await expect(topCard).toBeVisible({ timeout: 20_000 });

    const evidenceLink = topCard.locator('a[href^="/"]').first();
    await expect(evidenceLink).toBeVisible();
    const href = await evidenceLink.getAttribute("href");
    expect(href).toBeTruthy();
    await evidenceLink.click();
    await page.waitForURL((u) => u.pathname !== "/investigate");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
