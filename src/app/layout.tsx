import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { MotionConfig } from "motion/react";
import "./globals.css";
import { SettingsProvider } from "@/state/settings-context";
import { APP_NAME } from "@/lib/constants";
import { MOTION, EASE_OUT } from "@/lib/motion";
import { HydrationMarker } from "@/components/hydration-marker";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — Incident Investigation & Recovery Simulator`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "BLACKBOX is a production incident investigation and recovery simulator: trigger failures, correlate telemetry, form root-cause hypotheses, and experiment with recovery actions in a deterministic environment.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen font-sans antialiased">
        <MotionConfig reducedMotion="user" transition={{ duration: MOTION.base, ease: EASE_OUT }}>
          <SettingsProvider>
            <HydrationMarker />
            {children}
            <Toaster theme="dark" position="bottom-right" richColors closeButton />
          </SettingsProvider>
        </MotionConfig>
      </body>
    </html>
  );
}
