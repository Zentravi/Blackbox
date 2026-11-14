"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import type { ScenarioId, SimState } from "@/simulation/types";
import type { IncidentOp } from "@/simulation/engine";
import {
  applyAction,
  createInitialState,
  derivePhase,
  resetScenario as resetScenarioEngine,
  step,
  switchScenario as switchScenarioEngine,
  rollbackAction as rollbackActionEngine,
  updateIncident,
} from "@/simulation/engine";
import { DEFAULT_SCENARIO_ID, getScenario } from "@/simulation/scenarios";
import {
  clearLocalSnapshot,
  getLocalSnapshotMeta,
  loadLocalSnapshot,
  saveLocalSnapshot,
} from "@/lib/snapshot";
import {
  beaconSaveSnapshot,
  clearRemoteSnapshot,
  fetchPersistenceStatus,
  loadRemoteSnapshot,
  saveRemoteSnapshot,
  type RemotePersistenceStatus,
} from "@/lib/persistence-client";
import { useSettings } from "./settings-context";

export interface PersistenceValue {
  /** Epoch ms of the last successful localStorage save (null = never). */
  localSavedAt: number | null;
  /** PostgreSQL status (null until the status endpoint answers). */
  remote: RemotePersistenceStatus | null;
  syncing: boolean;
  /** Force a full synchronous save (snapshot + normalised tables). */
  saveNow: () => Promise<boolean>;
  /** Re-load state from the database (only meaningful without a local snapshot). */
  restoreFromDb: () => Promise<boolean>;
  clearLocal: () => void;
  clearDb: () => Promise<boolean>;
}

interface SimulationContextValue {
  state: SimState;
  running: boolean;
  speed: number;
  phase: ReturnType<typeof derivePhase>;
  setRunning: (v: boolean) => void;
  setSpeed: (v: number) => void;
  tickOnce: () => void;
  apply: (actionId: string) => void;
  rollback: (appliedId: string) => void;
  incidentOp: (incidentId: string, change: IncidentOp) => void;
  loadScenario: (scenarioId: ScenarioId) => void;
  reset: () => void;
  persistence: PersistenceValue;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

type Limits = { historyLimit: number; logLimit: number };

function trimToLimits(s: SimState, limits: Limits): SimState {
  if (s.historyLimit === limits.historyLimit && s.logLimit === limits.logLimit) return s;
  const metrics: SimState["metrics"] = {};
  for (const [id, series] of Object.entries(s.metrics)) {
    metrics[id] = series.slice(-limits.historyLimit);
  }
  return {
    ...s,
    historyLimit: limits.historyLimit,
    logLimit: limits.logLimit,
    metrics,
    healthSeries: s.healthSeries.slice(-limits.historyLimit),
    logs: s.logs.slice(-limits.logLimit),
  };
}

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const { settings, loaded } = useSettings();
  const [state, setState] = useState<SimState>(() => createInitialState(DEFAULT_SCENARIO_ID));
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const stateRef = useRef(state);
  const appliedSettings = useRef(false);

  // Persistence (localStorage + optional PostgreSQL via /api/persistence).
  const [localSavedAt, setLocalSavedAt] = useState<number | null>(null);
  const [remote, setRemote] = useState<RemotePersistenceStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const remoteRef = useRef<RemotePersistenceStatus | null>(null);
  // Throttle timestamps start at 0 and are seeded inside the save effects
  // (Date.now() is impure, so it cannot run during render). Seeding on first
  // effect run — instead of treating 0 as "epoch" — prevents an immediate
  // first save that would write a local snapshot before the database restore
  // can run and silently defeat restore in a fresh browser profile.
  const lastLocalSave = useRef(0);
  const lastRemoteSave = useRef(0);
  const dbRestoreAttempted = useRef(false);

  const commit = useCallback((next: SimState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Serialise remote saves from this client: fire-and-forget calls (scenario
  // reset, apply/rollback) plus manual "Save now" would otherwise race on the
  // wire and let an older payload land last. The payload is captured when the
  // save is requested; execution waits for the previous save to finish.
  const remoteSaveChain = useRef<Promise<unknown>>(Promise.resolve());

  const persistRemote = useCallback(async (mode: "snapshot" | "full"): Promise<boolean> => {
    if (!remoteRef.current?.configured) return false;
    setSyncing(true);
    const payload = stateRef.current;
    const run = remoteSaveChain.current.then(() => saveRemoteSnapshot(payload, mode));
    remoteSaveChain.current = run.catch(() => ({ ok: false }));
    try {
      const res = await run;
      const base = remoteRef.current ?? { configured: true, connected: res.ok };
      setRemote({
        ...base,
        connected: res.ok,
        error: res.error,
        tick: payload.tick,
        scenarioId: payload.scenarioId,
        updatedAt: res.ok ? new Date().toISOString() : base.updatedAt,
      });
      remoteRef.current = { ...base, connected: res.ok, error: res.error };
      return res.ok;
    } finally {
      setSyncing(false);
    }
  }, []);

  const saveNow = useCallback(async () => {
    const saved = saveLocalSnapshot(stateRef.current);
    if (saved) setLocalSavedAt(Date.now());
    return persistRemote("full");
  }, [persistRemote]);

  const restoreFromDb = useCallback(async () => {
    const remoteState = await loadRemoteSnapshot();
    if (!remoteState) return false;
    commit(
      trimToLimits(remoteState, {
        historyLimit: settings.historyWindow,
        logLimit: settings.logCap,
      }),
    );
    return true;
  }, [commit, settings.historyWindow, settings.logCap]);

  const clearLocal = useCallback(() => {
    clearLocalSnapshot();
    setLocalSavedAt(null);
  }, []);

  const clearDb = useCallback(async () => {
    const res = await clearRemoteSnapshot();
    if (res.ok) {
      setRemote({ configured: true, connected: true });
      remoteRef.current = { configured: true, connected: true };
    }
    return res.ok;
  }, []);

  // Hydration-safe restore: the server rendered the deterministic default
  // state; swap in the localStorage snapshot after mount (never during SSR).
  const localRestoreDone = useRef(false);
  useEffect(() => {
    if (localRestoreDone.current) return;
      localRestoreDone.current = true;
      const meta = getLocalSnapshotMeta();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of an external-storage timestamp (same pattern as readSettings above)
      if (meta) setLocalSavedAt(meta.savedAt);
    const snap = loadLocalSnapshot();
    if (
      snap &&
      (snap.tick !== stateRef.current.tick ||
        snap.scenarioId !== stateRef.current.scenarioId ||
        snap.actions.length !== stateRef.current.actions.length)
    ) {
      commit(snap);
    }
  }, [commit]);

  // Fetch PostgreSQL persistence status once.
  useEffect(() => {
    let cancelled = false;
    fetchPersistenceStatus().then((s) => {
      if (!cancelled) {
        remoteRef.current = s;
        setRemote(s);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // When there is no local snapshot, try restoring from the database once
  // settings are loaded (so history limits apply to the restored state).
  useEffect(() => {
    if (!loaded || dbRestoreAttempted.current) return;
    if (localRestoreDone.current && loadLocalSnapshot()) return; // local wins
    dbRestoreAttempted.current = true;
    void (async () => {
      const remoteState = await loadRemoteSnapshot();
      if (!remoteState) return;
      if (localRestoreDone.current && loadLocalSnapshot()) return; // local appeared meanwhile
      commit(
        trimToLimits(remoteState, {
          historyLimit: settings.historyWindow,
          logLimit: settings.logCap,
        }),
      );
      toast.info("Restored from database", {
        description: `Resumed ${remoteState.scenarioId} at tick ${remoteState.tick}.`,
      });
    })();
  }, [loaded, commit, settings.historyWindow, settings.logCap]);

  // Throttled localStorage autosave (trailing — the last change is always kept).
  useEffect(() => {
    if (lastLocalSave.current === 0) lastLocalSave.current = Date.now();
    const wait = Math.max(0, 4000 - (Date.now() - lastLocalSave.current));
    const id = window.setTimeout(() => {
      lastLocalSave.current = Date.now();
      if (saveLocalSnapshot(stateRef.current)) setLocalSavedAt(lastLocalSave.current);
    }, wait);
    return () => window.clearTimeout(id);
  }, [state]);

  // Throttled PostgreSQL snapshot autosave while the database is configured.
  useEffect(() => {
    if (!remote?.configured) return;
    if (lastRemoteSave.current === 0) lastRemoteSave.current = Date.now();
    const wait = Math.max(0, 30000 - (Date.now() - lastRemoteSave.current));
    const id = window.setTimeout(() => {
      lastRemoteSave.current = Date.now();
      void persistRemote("snapshot");
    }, wait);
    return () => window.clearTimeout(id);
  }, [state, remote?.configured, persistRemote]);

  // Durability on tab close / backgrounding.
  useEffect(() => {
    const flush = () => {
      lastLocalSave.current = Date.now();
      if (saveLocalSnapshot(stateRef.current)) setLocalSavedAt(lastLocalSave.current);
      if (remoteRef.current?.configured) beaconSaveSnapshot(stateRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Apply persisted simulation preferences once settings are loaded.
  useEffect(() => {
    if (!loaded || appliedSettings.current) return;
    appliedSettings.current = true;
    setRunning(settings.autoStart);
    setSpeed(settings.defaultSpeed);
    commit(
      trimToLimits(stateRef.current, {
        historyLimit: settings.historyWindow,
        logLimit: settings.logCap,
      }),
    );
  }, [loaded, settings, commit]);

  // Keep limits in sync when the user changes them in Settings.
  useEffect(() => {
    if (!loaded) return;
    const next = trimToLimits(stateRef.current, {
      historyLimit: settings.historyWindow,
      logLimit: settings.logCap,
    });
    if (next !== stateRef.current) commit(next);
  }, [loaded, settings.historyWindow, settings.logCap, commit]);

  // Deterministic tick loop.
  useEffect(() => {
    if (!running) return;
    const ms = Math.round(1000 / speed);
    const id = window.setInterval(() => {
      commit(step(stateRef.current));
    }, ms);
    return () => window.clearInterval(id);
  }, [running, speed, commit]);

  const tickOnce = useCallback(() => {
    commit(step(stateRef.current));
  }, [commit]);

  const apply = useCallback(
    (actionId: string) => {
      const scenario = getScenario(stateRef.current.scenarioId);
      const def = scenario.actions.find((a) => a.id === actionId);
      const before = stateRef.current.health;
      const next = applyAction(stateRef.current, actionId);
      if (next === stateRef.current) return;
      commit(next);
      void persistRemote("full");
      const delta = next.health - before;
      const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
      toast.success(`${def?.name ?? actionId} applied`, {
        description: `Health ${before} → ${next.health} (${deltaStr}) at tick ${next.tick}`,
      });
    },
    [commit, persistRemote],
  );

  const rollback = useCallback(
    (appliedId: string) => {
      const record = stateRef.current.actions.find((a) => a.id === appliedId);
      const next = rollbackActionEngine(stateRef.current, appliedId);
      if (next === stateRef.current) {
        toast.error("Rollback not possible", {
          description: "Only the most recent active recovery action can be rolled back.",
        });
        return;
      }
      commit(next);
      void persistRemote("full");
      toast.info(`Rolled back: ${record?.name ?? appliedId}`);
    },
    [commit, persistRemote],
  );

  const incidentOp = useCallback(
    (incidentId: string, change: IncidentOp) => {
      const next = updateIncident(stateRef.current, incidentId, change);
      commit(next);
      void persistRemote("full");
      if (change.op === "ack") toast.success("Incident acknowledged");
      if (change.op === "investigate") toast.success("Incident moved to investigating");
      if (change.op === "resolve") toast.success("Incident resolved", { description: "Outcome recorded in Reports." });
      if (change.op === "rootCause") toast.success("Root cause recorded");
    },
    [commit, persistRemote],
  );

  const loadScenario = useCallback(
    (scenarioId: ScenarioId) => {
      const next = switchScenarioEngine(stateRef.current, scenarioId, {
        historyLimit: settings.historyWindow,
        logLimit: settings.logCap,
      });
      commit(next);
      void persistRemote("full");
      toast.success(`Scenario loaded: ${getScenario(scenarioId).name}`, {
        description: "History warmed up — the incident timeline starts at the fault onset.",
      });
    },
    [commit, persistRemote, settings.historyWindow, settings.logCap],
  );

  const reset = useCallback(() => {
    const next = resetScenarioEngine(stateRef.current, {
      historyLimit: settings.historyWindow,
      logLimit: settings.logCap,
    });
    commit(next);
    void persistRemote("full");
    toast.info("Scenario reset to its initial state");
  }, [commit, persistRemote, settings.historyWindow, settings.logCap]);

  const phase = useMemo(() => derivePhase(state), [state]);

  const persistence = useMemo<PersistenceValue>(
    () => ({
      localSavedAt,
      remote,
      syncing,
      saveNow,
      restoreFromDb,
      clearLocal,
      clearDb,
    }),
    [localSavedAt, remote, syncing, saveNow, restoreFromDb, clearLocal, clearDb],
  );

  const value = useMemo(
    () => ({
      state,
      running,
      speed,
      phase,
      setRunning,
      setSpeed,
      tickOnce,
      apply,
      rollback,
      incidentOp,
      loadScenario,
      reset,
      persistence,
    }),
    [
      state,
      running,
      speed,
      phase,
      tickOnce,
      apply,
      rollback,
      incidentOp,
      loadScenario,
      reset,
      persistence,
    ],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation(): SimulationContextValue {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within SimulationProvider");
  return ctx;
}
