import "server-only";

import { and, desc, eq, isNull, or, type SQL, sql } from "drizzle-orm";
import { db } from "./client";
import {
  client as clientTable,
  insight,
  knowledgeChunk,
  knowledgeDocument,
  metricsDaily,
  recommendation,
  upload,
} from "./imcc-schema";

/**
 * Tenancy guard.
 *
 * Every Intelligent Marketing Command Center table carries an `orgId`. To keep
 * client data isolated (a hard requirement for a real product), ALL domain
 * queries must be filtered by the caller's org. Rather than trusting each call
 * site to remember, funnel access through `scopedDb(orgId)`.
 *
 * Pattern:
 *   const sdb = scopedDb(ctx.orgId);
 *   const clients = await sdb.listClients();
 *
 * When you add a new query, add a method here so the orgId filter is always
 * applied — writes stamp `orgId`, reads filter on it.
 */
export function scopedDb(orgId: string) {
  if (!orgId) {
    throw new Error("scopedDb requires an orgId — refusing to run unscoped");
  }

  /** Combine the mandatory orgId filter with any additional conditions. */
  function scopedWhere(
    orgColumn: SQL.Aliased | Parameters<typeof eq>[0],
    ...conditions: (SQL | undefined)[]
  ): SQL {
    // biome-ignore lint/style/noNonNullAssertion: `and` always returns SQL here
    return and(eq(orgColumn as never, orgId), ...conditions)!;
  }

  return {
    orgId,
    db,
    scopedWhere,

    // --- Clients ------------------------------------------------------------

    listClients() {
      return db
        .select()
        .from(clientTable)
        .where(eq(clientTable.orgId, orgId))
        .orderBy(desc(clientTable.createdAt));
    },

    getClient(clientId: string) {
      return db
        .select()
        .from(clientTable)
        .where(and(eq(clientTable.orgId, orgId), eq(clientTable.id, clientId)))
        .limit(1);
    },

    createClient(values: { name: string; objectives?: string | null }) {
      return db
        .insert(clientTable)
        .values({ orgId, name: values.name, objectives: values.objectives })
        .returning();
    },

    /** True if the client exists AND belongs to this org. */
    async ownsClient(clientId: string) {
      const [row] = await this.getClient(clientId);
      return Boolean(row);
    },

    // --- Metrics ------------------------------------------------------------

    getClientMetrics(clientId: string) {
      return db
        .select()
        .from(metricsDaily)
        .where(
          and(
            eq(metricsDaily.orgId, orgId),
            eq(metricsDaily.clientId, clientId)
          )
        )
        .orderBy(metricsDaily.date);
    },

    insertMetrics(rows: (typeof metricsDaily.$inferInsert)[]) {
      if (rows.length === 0) {
        return Promise.resolve([]);
      }
      // Force the org stamp on every row regardless of caller input.
      const stamped = rows.map((r) => ({ ...r, orgId }));
      return db.insert(metricsDaily).values(stamped).returning({
        id: metricsDaily.id,
      });
    },

    // --- Uploads (ingestion audit) -----------------------------------------

    createUpload(values: {
      clientId: string;
      filename: string;
      platform: string;
      blobUrl?: string | null;
    }) {
      return db
        .insert(upload)
        .values({ ...values, orgId, status: "processing" })
        .returning();
    },

    finishUpload(
      uploadId: string,
      values: {
        status: "completed" | "failed";
        rowsIngested?: number;
        error?: string | null;
      }
    ) {
      return db
        .update(upload)
        .set(values)
        .where(and(eq(upload.orgId, orgId), eq(upload.id, uploadId)))
        .returning();
    },

    listUploads(clientId?: string) {
      return db
        .select()
        .from(upload)
        .where(
          clientId
            ? and(eq(upload.orgId, orgId), eq(upload.clientId, clientId))
            : eq(upload.orgId, orgId)
        )
        .orderBy(desc(upload.createdAt));
    },

    // --- Knowledge (RAG corpus) --------------------------------------------

    createKnowledgeDocument(values: {
      clientId?: string | null;
      title: string;
      kind?: "brief" | "strategy_note" | "campaign_writeup" | "best_practice";
      source?: string | null;
      status?: "queued" | "embedding" | "completed" | "failed";
    }) {
      return db
        .insert(knowledgeDocument)
        .values({ ...values, orgId })
        .returning();
    },

    /**
     * List documents with embedding progress (total vs embedded chunk counts)
     * for the dashboard. `count(embedding)` counts only non-null embeddings.
     */
    listDocumentsWithProgress() {
      return db
        .select({
          id: knowledgeDocument.id,
          title: knowledgeDocument.title,
          status: knowledgeDocument.status,
          error: knowledgeDocument.error,
          createdAt: knowledgeDocument.createdAt,
          total: sql<number>`count(${knowledgeChunk.id})::int`,
          embedded: sql<number>`count(${knowledgeChunk.embedding})::int`,
        })
        .from(knowledgeDocument)
        .leftJoin(
          knowledgeChunk,
          eq(knowledgeChunk.documentId, knowledgeDocument.id)
        )
        .where(eq(knowledgeDocument.orgId, orgId))
        .groupBy(knowledgeDocument.id)
        .orderBy(desc(knowledgeDocument.createdAt));
    },

    insertKnowledgeChunks(rows: (typeof knowledgeChunk.$inferInsert)[]) {
      if (rows.length === 0) {
        return Promise.resolve([]);
      }
      const stamped = rows.map((r) => ({ ...r, orgId }));
      return db
        .insert(knowledgeChunk)
        .values(stamped)
        .returning({ id: knowledgeChunk.id });
    },

    /**
     * Semantic search over the knowledge corpus via pgvector cosine distance.
     * Scoped to this org; when a clientId is given, includes that client's docs
     * plus agency-wide (clientId IS NULL) docs. Only embedded chunks match.
     */
    async searchKnowledge(
      embedding: number[],
      opts: { clientId?: string; k?: number } = {}
    ) {
      const k = opts.k ?? 6;
      const vec = `[${embedding.join(",")}]`;
      const distance = sql<number>`${knowledgeChunk.embedding} <=> ${vec}::vector`;
      const scope = opts.clientId
        ? and(
            eq(knowledgeChunk.orgId, orgId),
            or(
              eq(knowledgeChunk.clientId, opts.clientId),
              isNull(knowledgeChunk.clientId)
            )
          )
        : eq(knowledgeChunk.orgId, orgId);

      const rows = await db
        .select({
          chunkId: knowledgeChunk.id,
          documentId: knowledgeChunk.documentId,
          content: knowledgeChunk.content,
          title: knowledgeDocument.title,
          metadata: knowledgeChunk.metadata,
          distance,
        })
        .from(knowledgeChunk)
        .innerJoin(
          knowledgeDocument,
          eq(knowledgeChunk.documentId, knowledgeDocument.id)
        )
        .where(and(scope, sql`${knowledgeChunk.embedding} is not null`))
        .orderBy(distance)
        .limit(k);

      return rows.map((r) => {
        const page = (r.metadata as { pageNumber?: number } | null)?.pageNumber;
        return {
          chunkId: r.chunkId,
          documentId: r.documentId,
          content: r.content,
          title: r.title,
          page: typeof page === "number" ? page : null,
          score: 1 - Number(r.distance),
        };
      });
    },

    listKnowledgeDocuments(clientId?: string) {
      // Agency-wide docs (clientId IS NULL) are visible to every client view.
      const scope = clientId
        ? and(
            eq(knowledgeDocument.orgId, orgId),
            or(
              eq(knowledgeDocument.clientId, clientId),
              isNull(knowledgeDocument.clientId)
            )
          )
        : eq(knowledgeDocument.orgId, orgId);
      return db
        .select()
        .from(knowledgeDocument)
        .where(scope)
        .orderBy(desc(knowledgeDocument.createdAt));
    },

    /**
     * Delete a knowledge document (and its chunks, via ON DELETE CASCADE).
     * Scoped to this org so one tenant can never delete another's docs.
     */
    deleteKnowledgeDocument(documentId: string) {
      return db
        .delete(knowledgeDocument)
        .where(
          and(
            eq(knowledgeDocument.orgId, orgId),
            eq(knowledgeDocument.id, documentId)
          )
        )
        .returning({ id: knowledgeDocument.id });
    },

    // --- Intelligence outputs ----------------------------------------------

    getClientInsights(clientId: string) {
      return db
        .select()
        .from(insight)
        .where(and(eq(insight.orgId, orgId), eq(insight.clientId, clientId)))
        .orderBy(desc(insight.createdAt));
    },

    insertInsights(rows: (typeof insight.$inferInsert)[]) {
      if (rows.length === 0) {
        return Promise.resolve([]);
      }
      const stamped = rows.map((r) => ({ ...r, orgId }));
      return db.insert(insight).values(stamped).returning({ id: insight.id });
    },

    getClientRecommendations(clientId: string) {
      return db
        .select()
        .from(recommendation)
        .where(
          and(
            eq(recommendation.orgId, orgId),
            eq(recommendation.clientId, clientId)
          )
        )
        .orderBy(desc(recommendation.createdAt));
    },
  };
}

export type ScopedDb = ReturnType<typeof scopedDb>;
