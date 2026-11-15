import type { AppliedAction, HypothesisResult, Incident, ScenarioDefinition, SimState } from "@/simulation/types";
import { getScenario } from "@/simulation/scenarios";
import { formatDateTime, formatMs, formatPct, formatTickDuration } from "@/lib/format";
import { TICK_MS, SIM_EPOCH_MS } from "@/simulation/config";

export interface ReportActionRow {
  id: string;
  name: string;
  tick: number;
  category: string;
  risk: string;
  healthDelta: number;
  errorBefore: number;
  errorAfter: number;
  p95Before: number;
  p95After: number;
  rolledBack: boolean;
  notes: string[];
}

export interface ReportImpact {
  peakErrorRate: number;
  peakLatencyP95Ms: number;
  minHealth: number;
  windowTicks: number;
}

export interface ReportModel {
  incident: Incident;
  scenarioName: string;
  actions: ReportActionRow[];
  impact: ReportImpact | null;
  rootCauseTitle: string | null;
  rootCauseConfidence: number | null;
  rootCauseSetBy: string | null;
  actualRootCauseTitle: string | null;
  verified: boolean | null;
  durationTicks: number;
  lessons: string[];
}

/** Aggregate the worst values observed during the incident window (active scenario only). */
export function computeImpact(state: SimState, incident: Incident): ReportImpact | null {
  if (incident.scenarioId !== state.scenarioId) return null;
  const scenario = getScenario(state.scenarioId);
  const from = Math.max(0, incident.openedTick);
  const to = incident.resolvedTick ?? state.tick;
  if (to <= from) return null;

  const weights = scenario.services.map((s) => s.baseline.rps);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const len = Object.values(state.metrics)[0]?.length ?? 0;
  let peakError = 0;
  let peakLatency = 0;
  let windowTicks = 0;

  for (let i = 0; i < len; i++) {
    const sample0 = state.metrics[scenario.services[0]!.id]?.[i];
    if (!sample0 || sample0.t < from || sample0.t > to) continue;
    windowTicks += 1;
    let err = 0;
    let lat = 0;
    scenario.services.forEach((def, si) => {
      const s = state.metrics[def.id]?.[i];
      if (!s) return;
      err += weights[si]! * s.errorRate;
      lat += weights[si]! * s.latencyP95Ms;
    });
    peakError = Math.max(peakError, err / totalWeight);
    peakLatency = Math.max(peakLatency, lat / totalWeight);
  }

  const healthWindow = state.healthSeries.filter((h) => h.t >= from && h.t <= to);
  const minHealth = healthWindow.length > 0 ? Math.min(...healthWindow.map((h) => h.health)) : state.health;

  return {
    peakErrorRate: peakError,
    peakLatencyP95Ms: peakLatency,
    minHealth,
    windowTicks,
  };
}

function buildLessons(
  incident: Incident,
  scenario: ScenarioDefinition,
  actions: ReportActionRow[],
  verified: boolean | null,
): string[] {
  const lessons: string[] = [];
  const actual = scenario.hypotheses.find((h) => h.actual);

  if (verified === false && actual) {
    lessons.push(
      `The recorded root cause did not match the planted cause — the actual origin was “${actual.title}”. Compare the evidence weights you trusted against the signals the engine ranked highest.`,
    );
  }
  if (verified === true) {
    lessons.push(
      "Root-cause hypothesis was confirmed by the engine after resolution — the evidence chain (logs → metrics → traces → dependencies) held up end to end.",
    );
  }

  const noChange = actions.filter((a) => Math.abs(a.healthDelta) < 0.5 && !a.rolledBack);
  for (const a of noChange) {
    lessons.push(
      `“${a.name}” produced no measurable health change — a valid negative result that rules this path out.`,
    );
  }

  const rolled = actions.filter((a) => a.rolledBack);
  for (const r of rolled) {
    lessons.push(
      `“${r.name}” was rolled back during the experiment — revert-before-verify keeps the blast radius contained.`,
    );
  }

  const helpful = [...actions]
    .filter((a) => !a.rolledBack)
    .sort((a, b) => b.healthDelta - a.healthDelta)[0];
  if (helpful && helpful.healthDelta > 2) {
    lessons.push(
      `Highest-leverage action: “${helpful.name}” (+${helpful.healthDelta.toFixed(1)} health).`,
    );
  }

  if (actions.length === 0) {
    lessons.push(
      "No recovery actions were applied during this incident — the scenario was resolved (or auto-resolved) without intervention.",
    );
  }

  if (incident.status !== "resolved") {
    lessons.push("Incident still open at export time — outcome sections will remain provisional.");
  }

  return lessons;
}

export function buildReport(state: SimState, incidentId: string): ReportModel | null {
  const incident = state.incidents.find((i) => i.id === incidentId);
  if (!incident) return null;
  const scenario = getScenario(incident.scenarioId);
  const isActiveScenario = incident.scenarioId === state.scenarioId;

  const actions: ReportActionRow[] = (isActiveScenario ? state.actions : [])
    .filter((a) => a.tick >= incident.openedTick)
    .map((a) => ({
      id: a.id,
      name: a.name,
      tick: a.tick,
      category: scenario.actions.find((def) => def.id === a.actionId)?.category ?? "mitigation",
      risk: scenario.actions.find((def) => def.id === a.actionId)?.risk ?? "low",
      healthDelta: Math.round((a.kpiAfter.health - a.kpiBefore.health) * 10) / 10,
      errorBefore: a.kpiBefore.errorRate,
      errorAfter: a.kpiAfter.errorRate,
      p95Before: a.kpiBefore.latencyP95Ms,
      p95After: a.kpiAfter.latencyP95Ms,
      rolledBack: a.rolledBack,
      notes: a.notes,
    }));

  const actual = scenario.hypotheses.find((h) => h.actual);
  const verified =
    incident.status === "resolved" && incident.rootCause && actual
      ? incident.rootCause.hypothesisId === actual.id
      : null;

  return {
    incident,
    scenarioName: scenario.name,
    actions,
    impact: computeImpact(state, incident),
    rootCauseTitle: incident.rootCause?.title ?? null,
    rootCauseConfidence: incident.rootCause?.confidence ?? null,
    rootCauseSetBy: incident.rootCause?.setBy ?? null,
    actualRootCauseTitle: incident.status === "resolved" && actual ? actual.title : null,
    verified,
    durationTicks: (incident.resolvedTick ?? state.tick) - incident.openedTick,
    lessons: buildLessons(incident, scenario, actions, verified),
  };
}

export function reportToJson(model: ReportModel): string {
  return JSON.stringify(
    {
      generatedBy: "BLACKBOX Incident Simulator",
      generatedAtTick: model.incident.resolvedTick ?? model.incident.openedTick,
      incident: model.incident,
      scenario: model.scenarioName,
      rootCause: {
        recorded: model.rootCauseTitle,
        confidence: model.rootCauseConfidence,
        setBy: model.rootCauseSetBy,
        actual: model.actualRootCauseTitle,
        verified: model.verified,
      },
      impact: model.impact,
      recoveryActions: model.actions,
      lessons: model.lessons,
    },
    null,
    2,
  );
}

export function reportToMarkdown(model: ReportModel, timezone: "utc" | "local" = "utc"): string {
  const inc = model.incident;
  const lines: string[] = [];

  lines.push(`# BLACKBOX Incident Report — ${inc.number}`);
  lines.push("");
  lines.push(`> ${inc.title}`);
  lines.push("");
  lines.push("## Incident summary");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Scenario | ${model.scenarioName} |`);
  lines.push(`| Severity | ${inc.severity.toUpperCase()} |`);
  lines.push(`| Status | ${inc.status} |`);
  lines.push(`| Opened | ${formatDateTime(inc.openedTs, timezone)} (T+${inc.openedTick}) |`);
  lines.push(
    inc.resolvedTs
      ? `| Resolved | ${formatDateTime(inc.resolvedTs, timezone)} (T+${inc.resolvedTick}) |`
      : `| Resolved | open |`,
  );
  lines.push(`| Duration | ${formatTickDuration(model.durationTicks)} |`);
  lines.push(`| Affected services | ${inc.serviceIds.join(", ")} |`);
  lines.push("");

  lines.push("## Description");
  lines.push("");
  lines.push(inc.description);
  lines.push("");

  if (model.impact) {
    lines.push("## Impact");
    lines.push("");
    lines.push(`- Peak error rate: **${formatPct(model.impact.peakErrorRate, 2)}**`);
    lines.push(`- Peak p95 latency: **${formatMs(model.impact.peakLatencyP95Ms)}**`);
    lines.push(`- Lowest health score: **${model.impact.minHealth.toFixed(0)}%**`);
    lines.push(`- Observed window: ${model.impact.windowTicks} ticks`);
    lines.push("");
  }

  lines.push("## Root cause analysis");
  lines.push("");
  if (model.rootCauseTitle) {
    lines.push(`- Recorded cause: **${model.rootCauseTitle}**`);
    lines.push(`- Confidence: ${Math.round((model.rootCauseConfidence ?? 0) * 100)}%`);
    lines.push(`- Set by: ${model.rootCauseSetBy}`);
    if (model.actualRootCauseTitle) {
      lines.push(
        model.verified
          ? "- Verification: ✅ matches the actual scenario root cause"
          : `- Verification: ❌ actual cause was “${model.actualRootCauseTitle}”`,
      );
    }
  } else {
    lines.push("- No root cause recorded during this incident.");
  }
  lines.push("");

  lines.push("## Timeline");
  lines.push("");
  lines.push("| Tick | Event | Actor | Message |");
  lines.push("| --- | --- | --- | --- |");
  for (const e of inc.timeline) {
    lines.push(`| T+${e.tick} | ${e.kind.replace("_", "-")} | ${e.actor} | ${e.message.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");

  lines.push("## Recovery actions");
  lines.push("");
  if (model.actions.length === 0) {
    lines.push("No recovery actions were applied in this run.");
  } else {
    lines.push("| Tick | Action | Category | Health Δ | Error before → after | p95 before → after | Rolled back |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const a of model.actions) {
      lines.push(
        `| T+${a.tick} | ${a.name} | ${a.category} | ${a.healthDelta >= 0 ? "+" : ""}${a.healthDelta} | ${formatPct(a.errorBefore, 2)} → ${formatPct(a.errorAfter, 2)} | ${formatMs(a.p95Before)} → ${formatMs(a.p95After)} | ${a.rolledBack ? "yes" : "no"} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Outcome");
  lines.push("");
  lines.push(inc.resolution ?? "Incident still open.");
  lines.push("");

  lines.push("## Lessons & observations");
  lines.push("");
  for (const l of model.lessons) lines.push(`- ${l}`);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(
    `Generated by BLACKBOX — deterministic incident simulation. Simulated epoch starts ${new Date(SIM_EPOCH_MS).toISOString()} at 1 tick = ${TICK_MS / 60000} minute(s).`,
  );
  lines.push("");
  return lines.join("\n");
}

export type { AppliedAction, HypothesisResult };
