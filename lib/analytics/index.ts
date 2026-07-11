import type { MetricsDaily } from "@/lib/db/imcc-schema";

/**
 * Deterministic performance analysis.
 *
 * SHELL / TODO: implement the actual math. These are pure functions over
 * already-fetched, org-scoped metric rows — no LLM involved. Results get
 * written to the `Insight` table by the caller (e.g. the cron route).
 */

export type DetectedInsight = {
  type: "trend" | "anomaly" | "opportunity" | "risk";
  severity: "info" | "warning" | "critical";
  title: string;
  detail?: string;
  payload?: unknown;
};

/** Period-over-period deltas per metric. TODO */
export function periodOverPeriod(_rows: MetricsDaily[]): DetectedInsight[] {
  return [];
}

/** z-score / threshold anomaly detection. TODO */
export function detectAnomalies(_rows: MetricsDaily[]): DetectedInsight[] {
  return [];
}

/** Run all analyzers over a client's metrics. */
export function analyzeClient(rows: MetricsDaily[]): DetectedInsight[] {
  return [...periodOverPeriod(rows), ...detectAnomalies(rows)];
}
