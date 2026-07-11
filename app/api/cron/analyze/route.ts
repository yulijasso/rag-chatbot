import { NextResponse } from "next/server";

/**
 * Scheduled performance analysis (SHELL).
 *
 * Register in vercel.json as a Cron Job. On each run (TODO):
 *   for each org → for each client:
 *     rows = scopedDb(orgId).getClientMetrics(clientId)
 *     insights = analyzeClient(rows)      // lib/analytics
 *     insert insights into the Insight table
 *
 * Protect with a CRON_SECRET check in production.
 */
export function GET() {
  // TODO(shell): iterate clients, run lib/analytics, persist Insight rows.
  return NextResponse.json({
    ok: true,
    todo: "run analytics per client and persist Insight rows",
  });
}
