import { expect, test } from "@playwright/test";
import { ensureScenario, freshScenario } from "./helpers";

test.describe("scenario switching & reload persistence", () => {
  test("topbar switcher loads another scenario and survives reload", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /Database connection exhaustion/i })).toBeVisible();

    await ensureScenario(page, /API latency degradation/i);

    // Topbar now shows the new scenario; incidents changed accordingly.
    await expect(page.getByRole("button", { name: /API latency degradation/i })).toBeVisible();
    await page.goto("/incidents");
    await expect(page.getByText(/worker pool|ranking|latency/i).first()).toBeVisible();

    // Reload → local snapshot restores the same scenario (issue #4).
    const tickBefore = await currentTick(page);
    await page.reload();
    await expect(page.getByRole("button", { name: /API latency degradation/i })).toBeVisible();
    const tickAfter = await currentTick(page);
    expect(tickAfter).toBeGreaterThanOrEqual(tickBefore);
  });

  test("reload resumes the simulation tick from the local snapshot", async ({ page }) => {
    await page.goto("/dashboard");
    // Advance one tick manually for a deterministic delta.
    await page.getByRole("button", { name: "Advance one tick" }).click();
    await page.getByRole("button", { name: "Pause simulation" }).click();
    const tick = await currentTick(page);
    expect(tick).toBeGreaterThan(0);

    await page.reload();
    await page.getByRole("button", { name: "Pause simulation" }).click(); // pause again
    const resumed = await currentTick(page);
    expect(resumed).toBeGreaterThanOrEqual(tick);
  });

  test("settings preferences persist across reload", async ({ page }) => {
    await page.goto("/settings");
    const autoStart = page.getByLabel("Auto-start simulation");
    await expect(autoStart).toBeVisible();
    // Let settings hydration (localStorage read) settle before interacting.
    await page.waitForTimeout(800);
    const before = await autoStart.isChecked();
    await autoStart.click();
    await expect(autoStart).toBeChecked({ checked: !before }); // toggle took effect
    await page.reload();
    await expect(autoStart).toBeChecked({ checked: !before }); // persisted across reload
    // restore
    await autoStart.click();
    await expect(autoStart).toBeChecked({ checked: before });
  });

  test("reset returns the scenario to its warm-up snapshot", async ({ page }) => {
    await page.goto("/dashboard");
    await freshScenario(page, /Database connection exhaustion/i);
  });
});

async function currentTick(page: import("@playwright/test").Page): Promise<number> {
  // The topbar shows `T+<tick>` somewhere on the page.
  const match = await page.getByText(/T\+\d+/).first().textContent();
  const n = match ? Number(match.replace(/\D+/g, "")) : NaN;
  expect(Number.isFinite(n)).toBe(true);
  return n;
}
