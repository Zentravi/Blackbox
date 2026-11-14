import { expect, type Page } from "@playwright/test";

const SCENARIO_NAMES = /Database connection exhaustion|API latency degradation|Cascading service failure/i;

/**
 * Wait until the client shell has hydrated (React handlers attached).
 * Clicks issued straight after `page.goto` can otherwise hit a server-
 * rendered button with no listener — animations (Motion) make hydration
 * slower, so every load should settle here before the first interaction.
 */
export async function waitForHydration(page: Page): Promise<void> {
  const logs: string[] = [];
  const onConsole = (m: { type: () => string; text: () => string }) => {
    if (m.type() === "error") logs.push(m.text());
  };
  const onPageError = (e: { message: string }) => logs.push("pageerror: " + e.message);
  page.on("console", onConsole as never);
  page.on("pageerror", onPageError as never);
  try {
    await page.locator("html[data-hydrated]").waitFor({ state: "attached", timeout: 25_000 });
  } catch {
    const state = await page
      .locator("html")
      .getAttribute("data-hydrated")
      .catch(() => "n/a");
    throw new Error(
      `hydration timeout (data-hydrated=${state}); console errors: ${
        logs.length ? logs.slice(0, 6).join(" || ") : "(none captured)"
      }`,
    );
  } finally {
    page.off("console", onConsole as never);
    page.off("pageerror", onPageError as never);
  }
}

/**
 * Ensure a specific scenario is active (opens the topbar switcher; if another
 * scenario is active, confirms the load dialog).
 */
export async function ensureScenario(page: Page, scenarioName: RegExp) {
  // Specs may call this before the first navigation (page is still about:blank).
  if (page.url() === "about:blank") await page.goto("/dashboard");
  await waitForHydration(page);
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
  await waitForHydration(page);
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
