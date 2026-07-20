import { list, put } from "@vercel/blob";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/auth/org";
import { db } from "@/lib/db/client";
import { knowledgeChunk, knowledgeDocument } from "@/lib/db/imcc-schema";
import {
  extractPageWords,
  matchRects,
  type PageWords,
  renderPageWebp,
} from "@/lib/ingestion/pdf-render";

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Renders a single PDF page to a cached WebP image and returns its URL plus
 * normalized highlight rectangles for the requested passages. First view of a
 * page renders + caches it (image and word boxes go to Blob); later views are
 * served from cache without touching the source PDF.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string; pageNumber: string }> }
) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { documentId, pageNumber: pageRaw } = await params;
  const pageNumber = Number(pageRaw);
  if (
    !UUID_RE.test(documentId) ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1
  ) {
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

  if (!doc?.source || !doc.title.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Not a viewable PDF" }, { status: 404 });
  }

  const base = `rendered/${documentId}/p${pageNumber}`;
  const imgPath = `${base}-s2.webp`;
  // Bump the version suffix when the word-position math changes so stale
  // (mis-aligned) cached coordinates are regenerated.
  const wordsPath = `${base}.words-v2.json`;

  // Look up what's already cached for this page.
  const { blobs } = await list({ prefix: base });
  let imageUrl = blobs.find((b) => b.pathname === imgPath)?.url;
  const wordsUrl = blobs.find((b) => b.pathname === wordsPath)?.url;

  let pdfBuffer: ArrayBuffer | null = null;
  const loadPdf = async () => {
    if (!pdfBuffer) {
      const res = await fetch(doc.source as string);
      if (!res.ok) {
        throw new Error(`Could not fetch source PDF (${res.status})`);
      }
      pdfBuffer = await res.arrayBuffer();
    }
    return pdfBuffer;
  };

  try {
    // Render + cache the page image if missing.
    if (!imageUrl) {
      const img = await renderPageWebp(await loadPdf(), pageNumber, 2);
      const uploaded = await put(imgPath, img.data, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "image/webp",
        cacheControlMaxAge: 31_536_000,
      });
      imageUrl = uploaded.url;
    }

    // Extract + cache the word boxes if missing.
    let words: PageWords;
    if (wordsUrl) {
      words = (await (await fetch(wordsUrl)).json()) as PageWords;
    } else {
      words = await extractPageWords(await loadPdf(), pageNumber);
      await put(wordsPath, JSON.stringify(words), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 31_536_000,
      });
    }

    // Passages to highlight = the requested chunks' text (org + doc scoped).
    const chunkIds = (new URL(request.url).searchParams.get("chunks") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => UUID_RE.test(s))
      .slice(0, 24);

    let passages: string[] = [];
    if (chunkIds.length > 0) {
      const rows = await db
        .select({ content: knowledgeChunk.content })
        .from(knowledgeChunk)
        .where(
          and(
            eq(knowledgeChunk.orgId, ctx.orgId),
            eq(knowledgeChunk.documentId, documentId),
            inArray(knowledgeChunk.id, chunkIds)
          )
        );
      passages = rows.map((r) => r.content);
    }

    const rects = passages.length > 0 ? matchRects(words.words, passages) : [];

    return NextResponse.json({
      imageUrl,
      width: words.width,
      height: words.height,
      rects,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "render failed";
    // Surface the real cause in Vercel logs to diagnose serverless failures.
    console.error("[page-render] failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
