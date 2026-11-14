"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { z } from "zod";

const SettingsSchema = z.object({
  workspaceName: z.string().min(1).max(64),
  environment: z.enum(["production", "staging", "development"]),
  timezone: z.enum(["utc", "local"]),
  density: z.enum(["comfortable", "compact"]),
  defaultSpeed: z.union([z.literal(0.5), z.literal(1), z.literal(2), z.literal(4)]),
  autoStart: z.boolean(),
  historyWindow: z.union([z.literal(60), z.literal(120), z.literal(180)]),
  logCap: z.union([z.literal(500), z.literal(1200), z.literal(2000)]),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  workspaceName: "Production (us-east-1)",
  environment: "production",
  timezone: "utc",
  density: "comfortable",
  defaultSpeed: 1,
  autoStart: true,
  historyWindow: 120,
  logCap: 1200,
};

const STORAGE_KEY = "blackbox.settings.v1";

interface SettingsContextValue {
  settings: Settings;
  loaded: boolean;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function readStored(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- one-shot localStorage
     hydration after mount. Starting from server-rendered defaults keeps the
     first client render identical to SSR (no hydration mismatch), then the
     stored settings are applied once. This is the standard localStorage
     pattern; useSyncExternalStore would expose stored values pre-hydration
     and break text hydration on every page that formats with settings. */
  useEffect(() => {
    setSettings(readStored());
    setLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Apply workspace density as a document-level attribute (see globals.css).
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.dataset.density = settings.density;
  }, [loaded, settings.density]);

  const persist = useCallback((next: Settings) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage may be unavailable — settings remain session-only
    }
  }, []);

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = SettingsSchema.parse({ ...prev, ...patch });
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const reset = useCallback(() => {
    persist(DEFAULT_SETTINGS);
    setSettings(DEFAULT_SETTINGS);
  }, [persist]);

  const value = useMemo(
    () => ({ settings, loaded, update, reset }),
    [settings, loaded, update, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
