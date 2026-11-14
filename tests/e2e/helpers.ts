import { expect, type Page } from "@playwright/test";

const SCENARIO_NAMES = /Database connection exhaustion|API latency degradation|Cascading service failure/i;

/**
 * Ensure a specific scenario is active (opens the topbar switcher; if another
 * scenario is active, confirms the load dialog).
 */
export async function ensureScenario(page: Page, scenarioName: RegExp) {
  // Specs may call this before the first navigation (page is still about:blank).
  if (page.url() === "about:blank") await page.goto("/dashboard");
  const trigger = page.getByRole("button", { name: SCENARIO_NAMES }).first();
  await trigger.click();
  const item = page.getByRole("menuitem", { name: scenarioName });
  await expect(item).toBeVisible();
  const isActive = (await item.locator("text=ACTIVE").count()) > 0;
  if (isActive) {
    await page.keyboard.press("Escape");
    return;
  }
  await item.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Load scenario" }).click();
  await expect(dialog).toBeHidden();
  // Ensure no overlay (dropdown/sheet) keeps the page aria-hidden.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: scenarioName })).toBeVisible();
}

/** Reset the active scenario to its deterministic warm-up snapshot. */
export async function resetScenario(page: Page) {
  if (page.url() === "about:blank") await page.goto("/dashboard");
  await page.getByRole("button", { name: "Reset scenario" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Reset scenario" }).click();
  await expect(dialog).toBeHidden();
}

/** Put a scenario into its fresh warm-up state (switch if needed, then reset). */
export async function freshScenario(page: Page, scenarioName: RegExp) {
  await ensureScenario(page, scenarioName);
  await resetScenario(page);
}

/** Switch scenario through the topbar dropdown (returns after confirm). */
export async function switchScenario(page: Page, scenarioName: RegExp) {
  await ensureScenario(page, scenarioName);
}
