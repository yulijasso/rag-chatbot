import { and, asc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/org";
import { db } from "@/lib/db/client";
import { knowledgeChunk, knowledgeDocument } from "@/lib/db/imcc-schema";

/**
 * Ordered chunks for a document, for the source viewer. Org-scoped so a tenant
 * can only read their own documents' text. Ordered by page then chunk index.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { documentId } = await params;
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(documentId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [doc] = await db
    .select({ id: knowledgeDocument.id, title: knowledgeDocument.title })
    .from(knowledgeDocument)
    .where(
      and(
        eq(knowledgeDocument.orgId, ctx.orgId),
        eq(knowledgeDocument.id, documentId)
      )
    )
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const chunks = await db
    .select({
      id: knowledgeChunk.id,
      content: knowledgeChunk.content,
      pageNumber: sql<number | null>`(${knowledgeChunk.metadata}->>'pageNumber')::int`,
      chunkIndex: sql<number | null>`(${knowledgeChunk.metadata}->>'chunkIndex')::int`,
    })
    .from(knowledgeChunk)
    .where(
      and(
        eq(knowledgeChunk.orgId, ctx.orgId),
        eq(knowledgeChunk.documentId, documentId)
      )
    )
    .orderBy(asc(knowledgeChunk.createdAt));

  // Sort by chunkIndex when present (stable document order).
  chunks.sort((a, b) => (a.chunkIndex ?? 0) - (b.chunkIndex ?? 0));

  return NextResponse.json({ title: doc.title, chunks });
}
