import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/org";
import { scopedDb } from "@/lib/db/scoped";

/** Documents with embedding progress, for the dashboard to poll. */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const documents = await scopedDb(ctx.orgId).listDocumentsWithProgress();
  return NextResponse.json({ documents });
}
