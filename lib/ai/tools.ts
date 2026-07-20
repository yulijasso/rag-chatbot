import { scopedDb } from "@/lib/db/scoped";
import { embeddingsEnabled, embedQuery } from "./embeddings";

/**
 * The agent's tools. This is the HYBRID-RETRIEVAL seam:
 *   - metricsQuery   → structured numbers (SQL over MetricsDaily)
 *   - vectorRetrieve → unstructured context (pgvector over KnowledgeChunk)
 *   - clientContext  → the client's objectives/profile
 *
 * SECURITY: every tool is constructed with the caller's { orgId, clientId } and
 * MUST only read that tenant's data. Build the tools with a factory so the scope
 * is captured in a closure and can never be spoofed by the model.
 *
 * TODO(you): wrap each of these as a LangChain `tool(...)` (or DynamicStructuredTool)
 * with a Zod schema, and hand the array to your agent in ./agent.ts.
 */

export type ToolScope = { orgId: string; clientId?: string };

export function makeTools(scope: ToolScope) {
  const sdb = scopedDb(scope.orgId);

  return {
    /** Structured metrics lookups (client-scoped). */
    async metricsQuery(_args: { question: string }) {
      // NEVER build raw SQL from model output — use parameterized helpers.
      if (!scope.clientId) {
        return [];
      }
      const rows = await sdb.getClientMetrics(scope.clientId);
      return rows;
    },

    /** Vector similarity over KnowledgeChunk (pgvector + Voyage embeddings). */
    async vectorRetrieve(args: { query: string; k?: number }) {
      if (!embeddingsEnabled()) {
        return [] as { content: string; title: string; score: number }[];
      }
      const vec = await embedQuery(args.query);
      if (!vec) {
        return [] as { content: string; title: string; score: number }[];
      }
      return sdb.searchKnowledge(vec, {
        clientId: scope.clientId,
        k: args.k,
      });
    },

    /** The client's objectives/profile to ground answers. */
    async clientContext() {
      if (!scope.clientId) {
        return null;
      }
      const [row] = await sdb.getClient(scope.clientId);
      return row ?? null;
    },
  };
}

export type Tools = ReturnType<typeof makeTools>;
