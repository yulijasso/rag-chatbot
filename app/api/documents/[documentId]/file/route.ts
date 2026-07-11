import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/org";
import { db } from "@/lib/db/client";
import { knowledgeDocument } from "@/lib/db/imcc-schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Streams a document's original file (from Vercel Blob) same-origin, so the
 * browser's native PDF viewer can render it in an <iframe> without cross-origin
 * / X-Frame-Options issues. Org-scoped: a tenant can only read their own files.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { documentId } = await params;
  if (!UUID_RE.test(documentId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [doc] = await db
    .select({
      source: knowledgeDocument.source,
      title: knowledgeDocument.title,
    })
    .from(knowledgeDocument)
    .where(
      and(
        eq(knowledgeDocument.orgId, ctx.orgId),
        eq(knowledgeDocument.id, documentId)
      )
    )
    .limit(1);

  if (!doc?.source) {
    return NextResponse.json(
      { error: "No file stored for this document" },
      { status: 404 }
    );
  }

  // Forward the browser's Range header to Blob so pdf.js can fetch only the
  // bytes it needs (page-by-page) instead of downloading the whole file — the
  // difference between a slow textbook load and an instant one.
  const range = request.headers.get("range");
  const upstream = await fetch(
    doc.source,
    range ? { headers: { range } } : undefined
  );
  if (!(upstream.ok && upstream.body)) {
    return NextResponse.json(
      { error: "Could not load the file from storage" },
      { status: 502 }
    );
  }

  const isPdf = doc.title.toLowerCase().endsWith(".pdf");
  const contentType = isPdf
    ? "application/pdf"
    : (upstream.headers.get("content-type") ?? "application/octet-stream");

  const headers = new Headers({
    "content-type": contentType,
    "content-disposition": `inline; filename="${doc.title.replace(/"/g, "")}"`,
    "cache-control": "private, max-age=300",
    "accept-ranges": "bytes",
  });
  // Pass through length/range so the client can do partial fetches.
  for (const h of ["content-length", "content-range"]) {
    const v = upstream.headers.get(h);
    if (v) {
      headers.set(h, v);
    }
  }

  // 206 when the range was honored, else 200.
  return new Response(upstream.body, {
    status: upstream.status === 206 ? 206 : 200,
    headers,
  });
}
