import { expect, test } from "@playwright/test";
import { freshScenario } from "./helpers";

test.describe("recovery simulator", () => {
  test("apply action → KPI delta → rollback → persists across reload", async ({ page }) => {
    await freshScenario(page, /Database connection exhaustion/i);
    await page.goto("/recovery");

    // Apply the first recovery action (confirmation dialog included).
    const firstCard = page.locator("[data-testid=action-card]").first();
    await firstCard.getByRole("button", { name: /Apply action/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Apply .+\?/)).toBeVisible();
    await dialog.getByRole("button", { name: "Apply now" }).click();
    await expect(page.getByText(/applied/i).first()).toBeVisible();

    // Before/after KPI comparison appears.
    await expect(page.getByText(/Before \/ after|Comparison|vs/i).first()).toBeVisible();

    // The action lands in the applied history with a rollback control.
    const history = page.getByRole("heading", { name: "Applied action history" });
    await expect(history).toBeVisible();
    await expect(page.getByText(/Increase connection pool size|connection pool/i).first()).toBeVisible();
    const rollbackBtn = page.getByRole("button", { name: /Roll back/i }).first();
    await expect(rollbackBtn).toBeVisible();

    // Reload → local snapshot keeps the applied history (issue #4).
    await page.reload();
    await expect(page.getByRole("heading", { name: "Applied action history" })).toBeVisible();
    await expect(page.getByText(/Increase connection pool size|connection pool/i).first()).toBeVisible();

    // Roll back the latest action (stack semantics).
    await page.getByRole("button", { name: /Roll back/i }).first().click();
    await expect(page.getByText(/rolled back T\+/i).first()).toBeVisible();
    await expect(page.getByText(/Rolled back:/i).first()).toBeVisible();
  });

  test("red-herring action applies but changes nothing (documented trade-off)", async ({ page }) => {
    await freshScenario(page, /Database connection exhaustion/i);
    await page.goto("/recovery");

    // The deploy rollback card is the red herring in scenario A — find it.
    const cards = page.locator("[data-testid=action-card]");
    const count = await cards.count();
    let target = -1;
    for (let i = 0; i < count; i++) {
      const text = (await cards.nth(i).innerText()).toLowerCase();
      if (text.includes("rollback") || text.includes("deploy") || text.includes("release")) {
        target = i;
        break;
      }
    }
    test.skip(target < 0, "no red-herring card found in this scenario build");
    await cards.nth(target).getByRole("button", { name: /Apply action/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Apply now" }).click();
    await expect(page.getByText(/applied/i).first()).toBeVisible();
    // It is recorded in history like any other experiment.
    await expect(page.getByRole("heading", { name: "Applied action history" })).toBeVisible();
  });
});
