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
import { useSettings } from "./settings-context";

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

  const commit = useCallback((next: SimState) => {
    stateRef.current = next;
    setState(next);
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
      const delta = next.health - before;
      const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1);
      toast.success(`${def?.name ?? actionId} applied`, {
        description: `Health ${before} → ${next.health} (${deltaStr}) at tick ${next.tick}`,
      });
    },
    [commit],
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
      toast.info(`Rolled back: ${record?.name ?? appliedId}`);
    },
    [commit],
  );

  const incidentOp = useCallback(
    (incidentId: string, change: IncidentOp) => {
      const next = updateIncident(stateRef.current, incidentId, change);
      commit(next);
      if (change.op === "ack") toast.success("Incident acknowledged");
      if (change.op === "investigate") toast.success("Incident moved to investigating");
      if (change.op === "resolve") toast.success("Incident resolved", { description: "Outcome recorded in Reports." });
      if (change.op === "rootCause") toast.success("Root cause recorded");
    },
    [commit],
  );

  const loadScenario = useCallback(
    (scenarioId: ScenarioId) => {
      const next = switchScenarioEngine(stateRef.current, scenarioId, {
        historyLimit: settings.historyWindow,
        logLimit: settings.logCap,
      });
      commit(next);
      toast.success(`Scenario loaded: ${getScenario(scenarioId).name}`, {
        description: "History warmed up — the incident timeline starts at the fault onset.",
      });
    },
    [commit, settings.historyWindow, settings.logCap],
  );

  const reset = useCallback(() => {
    const next = resetScenarioEngine(stateRef.current, {
      historyLimit: settings.historyWindow,
      logLimit: settings.logCap,
    });
    commit(next);
    toast.info("Scenario reset to its initial state");
  }, [commit, settings.historyWindow, settings.logCap]);

  const phase = useMemo(() => derivePhase(state), [state]);

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
    }),
    [state, running, speed, phase, tickOnce, apply, rollback, incidentOp, loadScenario, reset],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation(): SimulationContextValue {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error("useSimulation must be used within SimulationProvider");
  return ctx;
}
