import { SCENARIOS } from "@/simulation/scenarios";
import type { SimState } from "@/simulation/types";

/**
 * Local (localStorage) snapshot of the simulation — powers instant reload
 * restore without any server. The PostgreSQL layer (src/server/persistence)
 * stores the same payload for durable/cross-device restore.
 */

const STORAGE_KEY = "blackbox.sim-snapshot.v1";

export interface SnapshotEnvelope {
  v: 1;
  savedAt: number;
  state: SimState;
}

/** Structural validation — cheap guard against corrupt/foreign payloads. */
export function isValidSimState(value: unknown): value is SimState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<SimState>;
  return (
    typeof s.scenarioId === "string" &&
    s.scenarioId in SCENARIOS &&
    typeof s.tick === "number" &&
    Number.isFinite(s.tick) &&
    typeof s.health === "number" &&
    typeof s.seed === "number" &&
    typeof s.services === "object" &&
    s.services !== null &&
    Array.isArray(s.logs) &&
    Array.isArray(s.traces) &&
    Array.isArray(s.incidents) &&
    Array.isArray(s.actions) &&
    typeof s.fault === "object" &&
    s.fault !== null
  );
}

export function saveLocalSnapshot(state: SimState): boolean {
  if (typeof window === "undefined") return false;
  try {
    const envelope: SnapshotEnvelope = { v: 1, savedAt: Date.now(), state };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    // Quota exceeded or storage disabled — persistence degrades gracefully.
    return false;
  }
}

export function loadLocalSnapshot(): SimState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const envelope = parsed as Partial<SnapshotEnvelope>;
    if (envelope.v !== 1 || !isValidSimState(envelope.state)) return null;
    return envelope.state;
  } catch {
    return null;
  }
}

export function getLocalSnapshotMeta(): { savedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const envelope = parsed as Partial<SnapshotEnvelope>;
    if (envelope.v !== 1 || typeof envelope.savedAt !== "number") return null;
    return { savedAt: envelope.savedAt };
  } catch {
    return null;
  }
}

export function clearLocalSnapshot(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
