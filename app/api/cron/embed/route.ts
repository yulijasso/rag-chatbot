import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { processPending } from "@/lib/ingestion/worker";

// Ingestion can take a while on the free Voyage tier; give the run headroom.
export const maxDuration = 300;

/**
 * Background ingestion worker. Advances the pipeline by a bounded amount:
 * extracts one queued document and embeds a batch of its chunks. Resumable —
 * call it repeatedly (Vercel Cron on a schedule, or the dashboard nudging it
 * while a document is processing) until `remaining` reaches 0.
 *
 * Auth: the Vercel Cron `Authorization: Bearer $CRON_SECRET` header, OR a
 * signed-in user (so the UI can drive progress without waiting for cron).
 */
async function run(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorized =
    (secret && request.headers.get("authorization") === `Bearer ${secret}`) ||
    Boolean((await auth())?.user);

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processPending();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "worker failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export function GET(request: NextRequest) {
  return run(request);
}

export function POST(request: NextRequest) {
  return run(request);
}
