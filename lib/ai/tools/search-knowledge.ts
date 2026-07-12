import { tool } from "ai";
import { z } from "zod";
import {
  embeddingsEnabled,
  embedQuery,
  rerankDocuments,
} from "@/lib/ai/embeddings";
import { scopedDb } from "@/lib/db/scoped";

/**
 * The RAG retrieval tool — the modern, tenant-scoped equivalent of the
 * notebook's `search_medical_knowledge`: embed the query with Voyage, run a
 * pgvector cosine search over the caller's KnowledgeChunk corpus, and return
 * the most relevant excerpts for the model to ground its answer in.
 *
 * Constructed with the caller's { orgId, clientId } so the model can never
 * reach another tenant's documents.
 */
export function searchKnowledge({
  orgId,
  clientId,
}: {
  orgId: string;
  clientId?: string;
}) {
  return tool({
    description:
      "Search the user's uploaded document knowledge base and return the most " +
      "relevant passages with their source document. The knowledge base holds " +
      "ANY files the user has uploaded — client briefs, strategy notes, campaign " +
      "write-ups, best-practice docs, reports, resumes, PDFs, Word docs, etc. " +
      "ALWAYS call this tool whenever the user refers to 'the uploaded file/ " +
      "document/PDF/resume', asks what a document says, or asks anything that " +
      "uploaded documents could answer — do NOT reply that you cannot access " +
      "files, because this tool IS your access to them. Ground your answer in " +
      "the returned excerpts and cite the source document and page number " +
      "(e.g. \"Source.pdf, p. 214\") when a `page` is present.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "A focused semantic search query, e.g. 'Q3 launch strategy for Glow Serum'"
        ),
      k: z
        .number()
        .int()
        .min(1)
        .max(12)
        .optional()
        .describe("How many passages to retrieve (default 6)"),
    }),
    execute: async ({ query, k }) => {
      if (!embeddingsEnabled()) {
        return {
          error:
            "Knowledge search is not configured (missing VOYAGE_API_KEY).",
        };
      }
      const vec = await embedQuery(query);
      if (!vec) {
        return { results: [] };
      }
      const want = k ?? 6;
      const sdb = scopedDb(orgId);
      // Retrieve a wider candidate set by embedding similarity, then rerank for
      // precision so weakly-related passages don't surface as sources.
      const candidates = await sdb.searchKnowledge(vec, {
        clientId,
        k: Math.max(want * 3, 15),
      });
      if (candidates.length === 0) {
        return {
          results: [],
          note: "No matching documents. The knowledge base may be empty or its chunks not yet embedded.",
        };
      }

      // Rerank; keep only passages that clear the relevance threshold.
      const RERANK_MIN = 0.45;
      const ranked = await rerankDocuments(
        query,
        candidates.map((c) => c.content)
      );
      const chosen = ranked
        ? ranked
            .filter((r) => r.score >= RERANK_MIN)
            .slice(0, want)
            .map((r) => ({ ...candidates[r.index], score: r.score }))
        : candidates.slice(0, want);

      if (chosen.length === 0) {
        return {
          results: [],
          note: "No sufficiently relevant passages were found in the knowledge base for this query.",
        };
      }

      return {
        results: chosen.map((r) => ({
          source: r.title,
          documentId: r.documentId,
          chunkId: r.chunkId,
          page: r.page ?? undefined,
          excerpt: r.content,
          score: Number(r.score.toFixed(3)),
        })),
      };
    },
  });
}
