import { put } from "@vercel/blob";
import { type NextRequest, NextResponse } from "next/server";
import { embedTexts, embeddingsEnabled } from "@/lib/ai/embeddings";
import { requireOrgContext } from "@/lib/auth/org";
import type { metricsDaily } from "@/lib/db/imcc-schema";
import { scopedDb } from "@/lib/db/scoped";
import { CsvSource } from "@/lib/ingestion/csv-source";
import {
  chunkPages,
  classifyDocument,
  extractPages,
  type KnowledgeKind,
} from "@/lib/ingestion/knowledge";
import { normalize } from "@/lib/ingestion/normalizer";
import type { NormalizedMetric, Platform } from "@/lib/ingestion/types";

const PLATFORMS: Platform[] = [
  "seller_center",
  "ads_manager",
  "affiliate_center",
  "business_suite",
  "other",
];

/** NormalizedMetric → MetricsDaily insert row (numeric cols are strings). */
function toMetricRow(
  m: NormalizedMetric,
  orgId: string
): typeof metricsDaily.$inferInsert {
  const s = (n?: number) => (n === undefined ? undefined : String(n));
  return {
    orgId,
    clientId: m.clientId,
    date: m.date,
    platform: m.platform,
    metricType: m.metricType,
    dimension: m.dimension,
    dimensionName: m.dimensionName,
    revenue: s(m.revenue),
    spend: s(m.spend),
    roas: s(m.roas),
    gmv: s(m.gmv),
    commission: s(m.commission),
    engagementRate: s(m.engagementRate),
    orders: m.orders,
    units: m.units,
    impressions: m.impressions,
    clicks: m.clicks,
  };
}

/**
 * CSV / PDF / DOCX ingestion endpoint.
 *
 *   CSV               → parse → normalize → MetricsDaily  (+ Upload audit)
 *   PDF / DOCX / text → extract → chunk → embed → KnowledgeChunk
 *
 * Everything is scoped to the caller's org; the client is verified to belong
 * to that org before any write.
 */
export async function POST(request: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireOrgContext>>;
  try {
    ctx = await requireOrgContext();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sdb = scopedDb(ctx.orgId);

  // --- Large-file path: process a file already uploaded to Vercel Blob ------
  // The browser sends { blobUrl, filename } as JSON (no big binary body), we
  // fetch the bytes server-side and run the same extract → chunk → embed flow.
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const { blobUrl, filename } = (await request.json()) as {
      blobUrl?: string;
      filename?: string;
    };
    if (!(blobUrl && filename)) {
      return NextResponse.json(
        { error: "blobUrl and filename are required" },
        { status: 400 }
      );
    }
    const docType = classifyDocument(filename, "");
    if (!docType) {
      return NextResponse.json(
        { error: `Unsupported file type: ${filename}. Use PDF, DOCX, TXT, or MD.` },
        { status: 415 }
      );
    }
    // Queue only — return instantly. The background worker (/api/cron/embed)
    // fetches the blob, extracts pages, and embeds chunks resumably. This is
    // what makes large documents (textbooks) production-safe.
    const [doc] = await sdb.createKnowledgeDocument({
      clientId: null,
      title: filename,
      kind: "strategy_note",
      source: blobUrl,
      status: "queued",
    });
    return NextResponse.json({
      ok: true,
      type: "queued",
      documentId: doc.id,
      status: "queued",
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Body too large / truncated (Next.js caps request bodies ~10MB, Vercel
    // functions ~4.5MB). Return JSON so the client shows a real message.
    return NextResponse.json(
      {
        error:
          "File is too large to upload directly (limit ~10MB). Use a smaller file.",
      },
      { status: 413 }
    );
  }
  const file = form.get("file");
  const clientIdRaw = form.get("clientId");
  const platformRaw = String(form.get("platform") ?? "other");
  const kind = (String(form.get("kind") ?? "strategy_note") ||
    "strategy_note") as KnowledgeKind;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  // clientId is optional. Without one, an upload becomes agency-wide knowledge
  // (clientId = null) — which the chatbot's searchKnowledge tool still finds.
  let clientId: string | null = null;
  if (typeof clientIdRaw === "string" && clientIdRaw) {
    if (!(await sdb.ownsClient(clientIdRaw))) {
      // Either the client doesn't exist or belongs to another org.
      return NextResponse.json({ error: "Unknown client" }, { status: 404 });
    }
    clientId = clientIdRaw;
  }

  const platform: Platform = PLATFORMS.includes(platformRaw as Platform)
    ? (platformRaw as Platform)
    : "other";
  const docType = classifyDocument(file.name, file.type);
  const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";

  // Store the raw upload for audit/reprocessing (only if Blob is configured).
  let blobUrl: string | undefined;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const blob = await put(
      `uploads/${ctx.orgId}/${clientId ?? "shared"}/${safe}`,
      file,
      { access: "public" }
    );
    blobUrl = blob.url;
  }

  // --- CSV → metrics (requires a client to attach the numbers to) -----------
  if (isCsv) {
    if (!clientId) {
      return NextResponse.json(
        { error: "CSV metrics require a client. Upload a PDF/DOCX/TXT/MD for the knowledge base instead." },
        { status: 400 }
      );
    }
    const [audit] = await sdb.createUpload({
      clientId,
      filename: file.name,
      platform,
      blobUrl,
    });
    try {
      const csv = await file.text();
      const rows = await new CsvSource(csv, platform).fetch();
      const metrics = normalize(platform, rows, { clientId, platform });
      const inserted = await sdb.insertMetrics(
        metrics.map((m) => toMetricRow(m, ctx.orgId))
      );
      await sdb.finishUpload(audit.id, {
        status: "completed",
        rowsIngested: inserted.length,
      });
      return NextResponse.json({
        ok: true,
        type: "metrics",
        parsedRows: rows.length,
        ingestedRows: inserted.length,
        uploadId: audit.id,
        blobUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "ingest failed";
      await sdb.finishUpload(audit.id, { status: "failed", error: message });
      return NextResponse.json({ error: message }, { status: 422 });
    }
  }

  // --- PDF / DOCX / text → knowledge ---------------------------------------
  if (docType) {
    // The Upload audit row requires a client, so only record it when we have
    // one; client-less (agency-wide) uploads skip the audit but still ingest.
    const [audit] = clientId
      ? await sdb.createUpload({
          clientId,
          filename: file.name,
          platform: "other",
          blobUrl,
        })
      : [null];
    try {
      const pages = await extractPages(await file.arrayBuffer(), docType);
      const pageChunks = chunkPages(pages);
      const contents = pageChunks.map((c) => c.content);
      const vectors = embeddingsEnabled()
        ? await embedTexts(contents, "document")
        : contents.map(() => null);

      const [doc] = await sdb.createKnowledgeDocument({
        clientId,
        title: file.name,
        kind,
        source: blobUrl,
      });
      await sdb.insertKnowledgeChunks(
        pageChunks.map((c, i) => ({
          orgId: ctx.orgId,
          clientId,
          documentId: doc.id,
          content: c.content,
          embedding: vectors[i] ?? null,
          metadata: { chunkIndex: c.chunkIndex, pageNumber: c.pageNumber },
        }))
      );
      if (audit) {
        await sdb.finishUpload(audit.id, {
          status: "completed",
          rowsIngested: pageChunks.length,
        });
      }
      return NextResponse.json({
        ok: true,
        type: "knowledge",
        documentId: doc.id,
        chunks: pageChunks.length,
        pages: pages.length,
        embedded: embeddingsEnabled(),
        blobUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "ingest failed";
      if (audit) {
        await sdb.finishUpload(audit.id, { status: "failed", error: message });
      }
      return NextResponse.json({ error: message }, { status: 422 });
    }
  }

  return NextResponse.json(
    { error: `Unsupported file type: ${file.name}. Use CSV, PDF, or DOCX.` },
    { status: 415 }
  );
}
