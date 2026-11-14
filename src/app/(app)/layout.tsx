"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SimulationProvider } from "@/state/simulation-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { EASE_IN, EASE_OUT, MOTION } from "@/lib/motion";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <SimulationProvider>
      <TooltipProvider delayDuration={250}>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="flex-1 px-3 py-4 sm:px-4 lg:px-6 lg:py-5">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={pathname}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: { duration: MOTION.base, ease: EASE_OUT } }}
                  exit={{ opacity: 0, y: -4, transition: { duration: 0.14, ease: EASE_IN } }}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        </div>
      </TooltipProvider>
    </SimulationProvider>
  );
}
