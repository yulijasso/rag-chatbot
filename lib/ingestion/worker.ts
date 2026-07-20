import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { embeddingsEnabled, embedTexts } from "@/lib/ai/embeddings";
import { db } from "@/lib/db/client";
import {
  type KnowledgeDocument,
  knowledgeChunk,
  knowledgeDocument,
} from "@/lib/db/imcc-schema";
import { chunkPages, classifyDocument, extractPages } from "./knowledge";

// Bounded work per invocation so a run never approaches the function timeout.
// With standard Voyage limits this embeds quickly; the embed step self-paces
// (batches + Retry-After) if limits are ever hit, staying crash-safe.
const MAX_CHUNKS_PER_RUN = 500;
const CHUNK_INSERT_BATCH = 500; // keep under Postgres parameter limits

/**
 * Advance the ingestion pipeline by a bounded amount. Idempotent and
 * resumable: extraction claims one queued doc atomically (SKIP LOCKED), and
 * embedding just fills in chunks where `embedding IS NULL`. Safe to call
 * concurrently (cron + manual nudge) without duplicating work.
 */
export async function processPending(): Promise<{
  extracted: number;
  embedded: number;
  remaining: number;
}> {
  let extracted = 0;
  let embedded = 0;

  await extractOneQueued().then((did) => {
    extracted = did ? 1 : 0;
  });

  if (embeddingsEnabled()) {
    embedded = await embedNextChunks();
    await completeFinishedDocs();
  }

  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(knowledgeDocument)
    .where(sql`${knowledgeDocument.status} in ('queued','embedding')`);
  return { extracted, embedded, remaining: Number(rows[0]?.n ?? 0) };
}

/** Claim one queued doc, extract + chunk it, and insert unembedded chunks. */
async function extractOneQueued(): Promise<boolean> {
  // Atomically claim a single queued doc so concurrent runs don't double-work.
  const claimed = (await db.execute(sql`
    update "KnowledgeDocument"
    set "status" = 'embedding'
    where "id" = (
      select "id" from "KnowledgeDocument"
      where "status" = 'queued'
      order by "createdAt" asc
      limit 1
      for update skip locked
    )
    returning "id", "orgId", "clientId", "title", "source"
  `)) as unknown as Pick<
    KnowledgeDocument,
    "id" | "orgId" | "clientId" | "title" | "source"
  >[];

  const doc = claimed[0];
  if (!doc) {
    return false;
  }

  try {
    if (!doc.source) {
      throw new Error("document has no source blob URL to fetch");
    }
    const docType = classifyDocument(doc.title, "");
    if (!docType) {
      throw new Error(`unsupported file type: ${doc.title}`);
    }
    const res = await fetch(doc.source);
    if (!res.ok) {
      throw new Error(`could not fetch blob (${res.status})`);
    }
    const pages = await extractPages(await res.arrayBuffer(), docType);
    const pageChunks = chunkPages(pages);

    if (pageChunks.length === 0) {
      // Nothing to embed — the document is effectively done.
      await db
        .update(knowledgeDocument)
        .set({ status: "completed" })
        .where(eq(knowledgeDocument.id, doc.id));
      return true;
    }

    for (let i = 0; i < pageChunks.length; i += CHUNK_INSERT_BATCH) {
      const slice = pageChunks.slice(i, i + CHUNK_INSERT_BATCH);
      await db.insert(knowledgeChunk).values(
        slice.map((c) => ({
          orgId: doc.orgId,
          clientId: doc.clientId,
          documentId: doc.id,
          content: c.content,
          embedding: null,
          metadata: { chunkIndex: c.chunkIndex, pageNumber: c.pageNumber },
        }))
      );
    }
    // Doc is already "embedding" from the claim; the embed stage takes over.
    return true;
  } catch (err) {
    await db
      .update(knowledgeDocument)
      .set({
        status: "failed",
        error: err instanceof Error ? err.message : "extraction failed",
      })
      .where(eq(knowledgeDocument.id, doc.id));
    return true;
  }
}

/** Embed up to MAX_CHUNKS_PER_RUN null-embedding chunks for embedding docs. */
async function embedNextChunks(): Promise<number> {
  const pending = await db
    .select({ id: knowledgeChunk.id, content: knowledgeChunk.content })
    .from(knowledgeChunk)
    .innerJoin(
      knowledgeDocument,
      eq(knowledgeChunk.documentId, knowledgeDocument.id)
    )
    .where(
      and(
        eq(knowledgeDocument.status, "embedding"),
        isNull(knowledgeChunk.embedding)
      )
    )
    .limit(MAX_CHUNKS_PER_RUN);

  if (pending.length === 0) {
    return 0;
  }

  const vectors = await embedTexts(
    pending.map((c) => c.content),
    "document"
  );

  // Collect the successfully-embedded rows and write them in ONE bulk update
  // (a VALUES join) instead of a round-trip per chunk — the difference between
  // ~14/s and hundreds/s.
  const rows: ReturnType<typeof sql>[] = [];
  for (let i = 0; i < pending.length; i++) {
    const vec = vectors[i];
    if (vec) {
      rows.push(sql`(${pending[i].id}::uuid, ${`[${vec.join(",")}]`}::vector)`);
    }
  }
  if (rows.length === 0) {
    return 0;
  }

  await db.execute(sql`
    update "KnowledgeChunk" as c
    set "embedding" = data.emb
    from (values ${sql.join(rows, sql`, `)}) as data(id, emb)
    where c."id" = data.id
  `);
  return rows.length;
}

/** Flip "embedding" docs to "completed" once they have chunks and none null. */
async function completeFinishedDocs(): Promise<void> {
  await db.execute(sql`
    update "KnowledgeDocument" d
    set "status" = 'completed'
    where d."status" = 'embedding'
      and exists (
        select 1 from "KnowledgeChunk" c where c."documentId" = d."id"
      )
      and not exists (
        select 1 from "KnowledgeChunk" c
        where c."documentId" = d."id" and c."embedding" is null
      )
  `);
}
