import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/lib/constants";

/**
 * Regression guard: every module advertised in the sidebar must have a real
 * route file (this is the class of bug where /logs was linked but missing).
 */
describe("route completeness", () => {
  const appDir = path.resolve("src/app/(app)");

  it.each(NAV_ITEMS.map((i) => [i.label, i.href] as const))(
    "%s → %s has a page.tsx",
    (_label, href) => {
      const page = path.join(appDir, href, "page.tsx");
      expect(fs.existsSync(page), `${href} route file`).toBe(true);
      const source = fs.readFileSync(page, "utf8");
      expect(source.length, `${href} page is substantive`).toBeGreaterThan(500);
      expect(source).toMatch(/["']use client["']|export default/);
    },
  );

  it("detail routes exist for incidents, services, traces and reports", () => {
    for (const route of [
      "incidents/[id]",
      "services/[id]",
      "traces/[id]",
      "reports/[id]",
    ]) {
      expect(fs.existsSync(path.join(appDir, route, "page.tsx")), route).toBe(true);
    }
  });

  it("persistence API routes exist", () => {
    for (const route of ["status", "save", "load", "clear"]) {
      expect(
        fs.existsSync(path.join("src/app/api/persistence", route, "route.ts")),
        `api/persistence/${route}`,
      ).toBe(true);
    }
  });

  it("sidebar navigation has exactly ten unique entries", () => {
    expect(NAV_ITEMS).toHaveLength(10);
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(10);
  });
});
