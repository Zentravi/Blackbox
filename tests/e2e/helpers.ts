import fs from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

const SCENARIO_NAMES = /Database connection exhaustion|API latency degradation|Cascading service failure/i;

/**
 * Shared persistence API token for e2e: environment variable first (CI sets
 * it in the workflow), then the local `.env.local` (same file the webServer
 * reads). Null when neither exists — persistence specs then skip.
 */
export function persistenceToken(): string | null {
  const fromEnv = process.env.PERSISTENCE_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
    const match = text.match(/^\s*PERSISTENCE_API_TOKEN\s*=\s*(.+?)\s*$/m);
    if (!match) return null;
    return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return null;
  }
}

/** Bearer header for direct API calls (the request fixture has its own jar). */
export function bearerHeaders(): Record<string, string> {
  const token = persistenceToken();
  if (!token) throw new Error("PERSISTENCE_API_TOKEN not available for e2e");
  return { authorization: `Bearer ${token}` };
}

/**
 * Authenticate a browser context / request fixture by exchanging the token
 * for the HttpOnly session cookie (what the Settings unlock control does).
 * Must run BEFORE the first page load so /api/persistence calls are allowed.
 */
export async function loginPersistence(request: APIRequestContext): Promise<void> {
  const token = persistenceToken();
  if (!token) throw new Error("PERSISTENCE_API_TOKEN not available for e2e");
  const res = await request.post("/api/auth/login", { data: { token } });
  if (!res.ok()) throw new Error(`persistence login failed: HTTP ${res.status()}`);
}

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
    // 40 s: the sandbox box runs e2e under heavy load (builds, embedded PG)
    // where hydration can exceed the old 25 s bound; genuine hangs still fail.
    await page.locator("html[data-hydrated]").waitFor({ state: "attached", timeout: 40_000 });
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
