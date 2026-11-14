import { expect, test } from "@playwright/test";
import { NAV_ITEMS } from "../../src/lib/constants";

/** Each module's actual <h1> (PageHeader title). */
const H1: Record<string, RegExp> = {
  "/dashboard": /System health/i,
  "/dependencies": /Dependency Map/i,
  "/services": /Service Monitor/i,
  "/incidents": /Incident Center/i,
  "/logs": /Log Explorer/i,
  "/traces": /Trace Explorer/i,
  "/investigate": /Investigation Engine/i,
  "/recovery": /Recovery Simulator/i,
  "/reports": /Reports/i,
  "/settings": /Settings/i,
};

/**
 * Every sidebar entry must open a functional page with real content —
 * this is the regression guard for "advertised module has no route".
 */
test.describe("navigation", () => {
  test("sidebar exposes all ten modules", async ({ page }) => {
    await page.goto("/dashboard");
    expect(NAV_ITEMS).toHaveLength(10);
    const sidebar = page.getByRole("complementary");
    for (const item of NAV_ITEMS) {
      await expect(
        sidebar.getByRole("link", { name: item.label, exact: true }),
        `sidebar link for ${item.label}`,
      ).toBeAttached();
    }
  });

  for (const item of NAV_ITEMS) {
    test(`${item.label} (${item.href}) renders a functional page`, async ({ page }) => {
      await page.goto("/dashboard");
      await page
        .getByRole("complementary")
        .getByRole("link", { name: item.label, exact: true })
        .click();
      await page.waitForURL((u) => u.pathname === item.href);

      // Each module shows its own heading and a non-empty main region.
      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();
      await expect(heading, `${item.href} h1`).toHaveText(H1[item.href]);

      // No error boundary / crash screen.
      await expect(page.getByText("Application error")).toHaveCount(0);

      // The page renders substantive content beyond the header.
      const mainText = (await page.locator("main").innerText()).trim();
      expect(mainText.length, `${item.href} main content`).toBeGreaterThan(120);
    });
  }

  test("deep links to detail routes work", async ({ page }) => {
    await page.goto("/dashboard");
    // Active incident card links into the incident detail page.
    const incidentLink = page.locator('a[href^="/incidents/"]').first();
    await incidentLink.click();
    await page.waitForURL(/\/incidents\/inc-/);
    // Detail page: h1 is the incident title; the id is shown as an eyebrow.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/INC-\d+/i).first()).toBeVisible();

    await page.goto("/services");
    await page.locator('a[href^="/services/"]').first().click();
    await page.waitForURL(/\/services\/[a-z-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await page.goto("/traces");
    // Trace rows navigate via router.push (not anchors) — click the first row.
    const traceRow = page.locator("tbody tr").first();
    await expect(traceRow).toBeVisible();
    await traceRow.click();
    await page.waitForURL(/\/traces\/tr-/);
    await expect(page.getByText(/Waterfall|Span/i).first()).toBeVisible();
  });
});
