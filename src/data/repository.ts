import type {
  Incident,
  LogEntry,
  MetricSample,
  SimState,
  Trace,
} from "@/simulation/types";

/**
 * Repository contract for the BLACKBOX data layer.
 *
 * The application ships with {@link InMemoryRepository}, which is fed
 * directly by the deterministic simulation engine — no external services are
 * required. A PostgreSQL implementation (Prisma) can satisfy the same
 * interface when `DATABASE_URL` is configured; see `docs/database.md`.
 *
 * All methods are async so swapping the implementation does not require
 * changes at call sites.
 */
export interface IncidentRepository {
  list(workspaceId: string): Promise<Incident[]>;
  byId(workspaceId: string, incidentId: string): Promise<Incident | null>;
  save(workspaceId: string, incident: Incident): Promise<void>;
}

export interface TelemetryRepository {
  appendLogs(workspaceId: string, logs: LogEntry[]): Promise<void>;
  queryLogs(workspaceId: string, filter: { serviceId?: string; sinceTick?: number; limit?: number }): Promise<LogEntry[]>;
  appendTraces(workspaceId: string, traces: Trace[]): Promise<void>;
  appendMetrics(workspaceId: string, serviceId: string, samples: MetricSample[]): Promise<void>;
}

export interface SettingsRepository {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
}

export interface WorkspaceRepository extends IncidentRepository, TelemetryRepository, SettingsRepository {
  /** Persist a whole simulation snapshot (used for durable hand-off). */
  saveState(state: SimState): Promise<void>;
}

/**
 * In-memory implementation — the default runtime store. State lives inside
 * the React simulation provider; this repository provides the async surface
 * that a Prisma-backed implementation would mirror.
 */
export class InMemoryRepository implements WorkspaceRepository {
  private incidents = new Map<string, Incident[]>();
  private logs = new Map<string, LogEntry[]>();
  private traces = new Map<string, Trace[]>();
  private metrics = new Map<string, MetricSample[]>();
  private settings = new Map<string, unknown>();

  async list(workspaceId: string): Promise<Incident[]> {
    return this.incidents.get(workspaceId) ?? [];
  }

  async byId(workspaceId: string, incidentId: string): Promise<Incident | null> {
    return (this.incidents.get(workspaceId) ?? []).find((i) => i.id === incidentId) ?? null;
  }

  async save(workspaceId: string, incident: Incident): Promise<void> {
    const list = this.incidents.get(workspaceId) ?? [];
    const idx = list.findIndex((i) => i.id === incident.id);
    if (idx >= 0) list[idx] = incident;
    else list.push(incident);
    this.incidents.set(workspaceId, list);
  }

  async appendLogs(workspaceId: string, logs: LogEntry[]): Promise<void> {
    const list = this.logs.get(workspaceId) ?? [];
    this.logs.set(workspaceId, [...list, ...logs].slice(-2000));
  }

  async queryLogs(
    workspaceId: string,
    filter: { serviceId?: string; sinceTick?: number; limit?: number },
  ): Promise<LogEntry[]> {
    let out = this.logs.get(workspaceId) ?? [];
    const { serviceId, sinceTick, limit } = filter;
    if (serviceId) out = out.filter((l) => l.serviceId === serviceId);
    if (typeof sinceTick === "number") out = out.filter((l) => l.tick >= sinceTick);
    if (limit) out = out.slice(-limit);
    return out;
  }

  async appendTraces(workspaceId: string, traces: Trace[]): Promise<void> {
    const list = this.traces.get(workspaceId) ?? [];
    this.traces.set(workspaceId, [...list, ...traces].slice(-500));
  }

  async appendMetrics(workspaceId: string, serviceId: string, samples: MetricSample[]): Promise<void> {
    const key = `${workspaceId}:${serviceId}`;
    const list = this.metrics.get(key) ?? [];
    this.metrics.set(key, [...list, ...samples].slice(-500));
  }

  async get<T>(key: string): Promise<T | null> {
    return (this.settings.get(key) as T | undefined) ?? null;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.settings.set(key, value);
  }

  async saveState(state: SimState): Promise<void> {
    await Promise.all(state.incidents.map((i) => this.save(state.scenarioId, i)));
    await this.appendLogs(state.scenarioId, state.logs.slice(-200));
    await this.appendTraces(state.scenarioId, state.traces.slice(-100));
  }
}

/** Process-wide default repository. */
let defaultRepo: WorkspaceRepository | null = null;

export function getRepository(): WorkspaceRepository {
  if (!defaultRepo) defaultRepo = new InMemoryRepository();
  return defaultRepo;
}
