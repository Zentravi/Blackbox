import type { ScenarioDefinition, ScenarioId } from "../types";
import { dbExhaustionScenario } from "./db-exhaustion";
import { apiLatencyScenario } from "./api-latency";
import { cascadingScenario } from "./cascading";

export const SCENARIOS = {
  "db-exhaustion": dbExhaustionScenario,
  "api-latency": apiLatencyScenario,
  cascading: cascadingScenario,
} as unknown as Record<ScenarioId, ScenarioDefinition>;

export const SCENARIO_LIST: ScenarioDefinition[] = [
  dbExhaustionScenario,
  apiLatencyScenario,
  cascadingScenario,
];

export const DEFAULT_SCENARIO_ID: ScenarioId = "db-exhaustion";

export function getScenario(id: ScenarioId): ScenarioDefinition {
  return SCENARIOS[id] ?? SCENARIOS[DEFAULT_SCENARIO_ID];
}
