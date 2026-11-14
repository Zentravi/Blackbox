import type { SimState } from "@/simulation/types";

/** Browser-side wrappers for the /api/persistence route handlers. */

export interface RemotePersistenceStatus {
  configured: boolean;
  connected: boolean;
  tick?: number;
  scenarioId?: string;
  updatedAt?: string;
  error?: string;
}

export async function fetchPersistenceStatus(): Promise<RemotePersistenceStatus> {
  try {
    const res = await fetch("/api/persistence/status");
    if (!res.ok) return { configured: false, connected: false };
    return (await res.json()) as RemotePersistenceStatus;
  } catch {
    return { configured: false, connected: false };
  }
}

export async function saveRemoteSnapshot(
  state: SimState,
  mode: "snapshot" | "full",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/persistence/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, mode }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

export async function loadRemoteSnapshot(): Promise<SimState | null> {
  try {
    const res = await fetch("/api/persistence/load");
    if (!res.ok) return null;
    const body = (await res.json()) as { state: SimState | null };
    return body.state;
  } catch {
    return null;
  }
}

export async function clearRemoteSnapshot(): Promise<{ ok: boolean }> {
  try {
    const res = await fetch("/api/persistence/clear", { method: "DELETE" });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

/** Fire-and-forget save for page unload (keeps the last tick durable). */
export function beaconSaveSnapshot(state: SimState): void {
  if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
  try {
    const blob = new Blob([JSON.stringify({ state, mode: "snapshot" })], {
      type: "application/json",
    });
    navigator.sendBeacon("/api/persistence/save", blob);
  } catch {
    // ignore
  }
}
