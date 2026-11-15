// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NAV_ITEMS } from "@/lib/constants";

vi.mock("@/state/simulation-context", () => ({
  useSimulation: () => ({
    phase: { tone: "ok", label: "Operational", note: "steady state" },
    state: { tick: 10, scenarioId: "db-exhaustion", incidents: [] },
    stateRef: { current: {} },
    commit: () => undefined,
    pause: () => undefined,
    resume: () => undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SidebarContent } from "@/components/layout/sidebar";

afterEach(cleanup);

describe("Sidebar (UI)", () => {
  it("renders every advertised module as a real link", () => {
    render(<SidebarContent />);
    for (const item of NAV_ITEMS) {
      const link = screen.getByRole("link", { name: item.label });
      expect(link.getAttribute("href")).toBe(item.href);
    }
    expect(screen.getAllByRole("link").length).toBeGreaterThanOrEqual(NAV_ITEMS.length);
  });

  it("groups navigation under the four section headings", () => {
    render(<SidebarContent />);
    for (const group of ["Overview", "Observe", "Respond", "System"]) {
      expect(screen.getByText(group)).toBeTruthy();
    }
  });

  it("marks the current route with aria-current", () => {
    render(<SidebarContent />);
    const dashboard = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboard.getAttribute("aria-current")).toBe("page");
    const logs = screen.getByRole("link", { name: "Log Explorer" });
    expect(logs.getAttribute("aria-current")).toBeNull();
  });
});
