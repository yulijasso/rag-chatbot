/**
 * Backfill embeddings for KnowledgeChunk rows that were stored before an
 * embeddings key was configured (embedding IS NULL). Idempotent — safe to
 * re-run. Run with:
 *
 *   NODE_OPTIONS='--conditions=react-server' \
 *     npx tsx --env-file=.env.local scripts/backfill-embeddings.ts
 */
import { eq, isNull } from "drizzle-orm";
import { embeddingsEnabled, embedTexts } from "@/lib/ai/embeddings";
import { db } from "@/lib/db/client";
import { knowledgeChunk } from "@/lib/db/imcc-schema";

const BATCH = 100;

async function main() {
  if (!embeddingsEnabled()) {
    console.error("VOYAGE_API_KEY not set — nothing to do.");
    process.exit(1);
  }

  const pending = await db
    .select({ id: knowledgeChunk.id, content: knowledgeChunk.content })
    .from(knowledgeChunk)
    .where(isNull(knowledgeChunk.embedding));

  console.log(`Chunks needing embedding: ${pending.length}`);
  if (pending.length === 0) {
    process.exit(0);
  }

  let done = 0;
  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const vectors = await embedTexts(
      batch.map((c) => c.content),
      "document"
    );
    for (let j = 0; j < batch.length; j++) {
      const vec = vectors[j];
      if (vec) {
        await db
          .update(knowledgeChunk)
          .set({ embedding: vec })
          .where(eq(knowledgeChunk.id, batch[j].id));
        done++;
      }
    }
    console.log(`  embedded ${done}/${pending.length}`);
  }

  console.log(`Done. Embedded ${done} chunks.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
