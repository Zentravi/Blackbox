import type { SimState } from "@/simulation/types";

/** Browser-side wrappers for the /api/persistence route handlers. */

export interface RemotePersistenceStatus {
  configured: boolean;
  connected: boolean;
  tick?: number;
  scenarioId?: string;
  updatedAt?: string;
  error?: string;
  /** True when the API answered 401/403: a valid token is required first. */
  locked?: boolean;
}

function lockedStatus(status: number): RemotePersistenceStatus {
  return {
    configured: false,
    connected: false,
    locked: true,
    error: status === 403 ? "auth_disabled" : "auth_required",
  };
}

export async function fetchPersistenceStatus(): Promise<RemotePersistenceStatus> {
  try {
    const res = await fetch("/api/persistence/status", { cache: "no-store" });
    if (res.status === 401 || res.status === 403) return lockedStatus(res.status);
    if (!res.ok) return { configured: false, connected: false };
    return (await res.json()) as RemotePersistenceStatus;
  } catch {
    return { configured: false, connected: false };
  }
}

export async function saveRemoteSnapshot(
  state: SimState,
  mode: "snapshot" | "full",
): Promise<{ ok: boolean; error?: string; locked?: boolean }> {
  try {
    const res = await fetch("/api/persistence/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, mode }),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, locked: true };
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

export async function clearRemoteSnapshot(): Promise<{ ok: boolean; locked?: boolean }> {
  try {
    const res = await fetch("/api/persistence/clear", {
      method: "DELETE",
      // Explicit confirmation header — the API rejects bare DELETEs (412).
      headers: { "x-confirm": "clear" },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, locked: true };
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

/** Exchange the shared API token for an HttpOnly session cookie. */
export async function loginWithToken(token: string): Promise<{ ok: boolean; locked?: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.status === 403) return { ok: false, locked: true };
    if (!res.ok) return { ok: false };
    return { ok: true };
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
