"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SimulationProvider } from "@/state/simulation-context";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SimulationProvider>
      <TooltipProvider delayDuration={250}>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="flex-1 px-3 py-4 sm:px-4 lg:px-6 lg:py-5">{children}</main>
          </div>
        </div>
      </TooltipProvider>
    </SimulationProvider>
  );
}
