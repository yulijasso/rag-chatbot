import { put } from "@vercel/blob";
import { type NextRequest, NextResponse } from "next/server";
import { embedTexts, embeddingsEnabled } from "@/lib/ai/embeddings";
import { requireOrgContext } from "@/lib/auth/org";
import type { metricsDaily } from "@/lib/db/imcc-schema";
import { scopedDb } from "@/lib/db/scoped";
import { CsvSource } from "@/lib/ingestion/csv-source";
import {
  chunkText,
  classifyDocument,
  extractText,
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

  const form = await request.formData();
  const file = form.get("file");
  const clientId = form.get("clientId");
  const platformRaw = String(form.get("platform") ?? "other");
  const kind = (String(form.get("kind") ?? "strategy_note") ||
    "strategy_note") as KnowledgeKind;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (typeof clientId !== "string" || !clientId) {
    return NextResponse.json(
      { error: "clientId is required" },
      { status: 400 }
    );
  }
  if (!(await sdb.ownsClient(clientId))) {
    // Either the client doesn't exist or belongs to another org — same answer.
    return NextResponse.json({ error: "Unknown client" }, { status: 404 });
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
    const blob = await put(`uploads/${ctx.orgId}/${clientId}/${safe}`, file, {
      access: "public",
    });
    blobUrl = blob.url;
  }

  // --- CSV → metrics --------------------------------------------------------
  if (isCsv) {
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
    const [audit] = await sdb.createUpload({
      clientId,
      filename: file.name,
      platform: "other",
      blobUrl,
    });
    try {
      const text = await extractText(await file.arrayBuffer(), docType);
      const chunks = chunkText(text);
      const vectors = embeddingsEnabled()
        ? await embedTexts(chunks, "document")
        : chunks.map(() => null);

      const [doc] = await sdb.createKnowledgeDocument({
        clientId,
        title: file.name,
        kind,
        source: blobUrl,
      });
      await sdb.insertKnowledgeChunks(
        chunks.map((content, i) => ({
          orgId: ctx.orgId,
          clientId,
          documentId: doc.id,
          content,
          embedding: vectors[i] ?? null,
          metadata: { chunkIndex: i },
        }))
      );
      await sdb.finishUpload(audit.id, {
        status: "completed",
        rowsIngested: chunks.length,
      });
      return NextResponse.json({
        ok: true,
        type: "knowledge",
        documentId: doc.id,
        chunks: chunks.length,
        embedded: embeddingsEnabled(),
        blobUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "ingest failed";
      await sdb.finishUpload(audit.id, { status: "failed", error: message });
      return NextResponse.json({ error: message }, { status: 422 });
    }
  }

  return NextResponse.json(
    { error: `Unsupported file type: ${file.name}. Use CSV, PDF, or DOCX.` },
    { status: 415 }
  );
}
