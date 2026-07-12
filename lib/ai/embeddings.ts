import "server-only";

/**
 * Embeddings for RAG.
 *
 * Uses Voyage AI `voyage-3` (1024 dims — matches KnowledgeChunk.embedding). We
 * call the REST API directly to avoid coupling to an SDK surface. If no
 * VOYAGE_API_KEY is configured, embedding DEGRADES GRACEFULLY: chunks are still
 * stored (with a null embedding) and can be back-filled once a key is added.
 */

export const EMBEDDING_MODEL = "voyage-3";
export const EMBEDDING_DIMENSIONS = 1024;

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.VOYAGE_API_KEY);
}

type VoyageResponse = {
  data: { embedding: number[]; index: number }[];
};

// Sized for standard (paid) Voyage rate limits: larger batches run a few at a
// time for throughput. The 429 handler still honors Retry-After, so this also
// self-throttles gracefully if limits are ever hit.
const BATCH_SIZE = 128;
const CONCURRENCY = 4;
const MAX_RETRIES = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Embed one batch (<= BATCH_SIZE texts) with retry/backoff on 429/5xx. */
async function embedBatch(
  texts: string[],
  inputType: "document" | "query",
  apiKey: string
): Promise<(number[] | null)[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: EMBEDDING_MODEL,
        input_type: inputType,
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as VoyageResponse;
      const ordered = new Array<number[] | null>(texts.length).fill(null);
      for (const item of json.data) {
        ordered[item.index] = item.embedding;
      }
      return ordered;
    }

    // Retry transient failures (rate limit / server). Prefer the server's
    // Retry-After hint (seconds); fall back to exponential backoff.
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 1000 + Math.random() * 500;
      await sleep(backoff);
      continue;
    }

    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Voyage embeddings failed (${res.status}): ${detail}`);
  }
}

/**
 * Embed any number of texts. Splits into batches (Voyage per-request limits)
 * and runs a few batches concurrently, so large documents (whole textbooks)
 * embed reliably instead of overflowing a single request. Order preserved.
 *
 * @param inputType "document" when embedding stored content, "query" at search
 * time — Voyage uses this to asymmetrically optimize retrieval.
 * @returns one vector per input, or `null` per input when embeddings are off.
 */
export async function embedTexts(
  texts: string[],
  inputType: "document" | "query" = "document"
): Promise<(number[] | null)[]> {
  if (texts.length === 0) {
    return [];
  }
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    return texts.map(() => null);
  }

  // Slice into ordered batches.
  const batches: { start: number; texts: string[] }[] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push({ start: i, texts: texts.slice(i, i + BATCH_SIZE) });
  }

  const results = new Array<number[] | null>(texts.length).fill(null);

  // Simple concurrency pool: workers pull the next batch until none remain.
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const batch = batches[cursor++];
      const vectors = await embedBatch(batch.texts, inputType, apiKey as string);
      for (let j = 0; j < vectors.length; j++) {
        results[batch.start + j] = vectors[j];
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker)
  );

  return results;
}

/** Embed a single query string for similarity search. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const [vec] = await embedTexts([text], "query");
  return vec ?? null;
}

export const RERANK_MODEL = "rerank-2.5";

/**
 * Rerank candidate passages against the query with Voyage's cross-encoder,
 * which judges query↔passage relevance far more precisely than embedding cosine
 * — the key to not surfacing weakly-related documents as sources. Returns
 * {index, score} sorted by relevance, or null if reranking is unavailable
 * (caller falls back to the embedding order).
 */
export async function rerankDocuments(
  query: string,
  documents: string[]
): Promise<{ index: number; score: number }[] | null> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey || documents.length === 0) {
    return null;
  }
  try {
    const res = await fetch("https://api.voyageai.com/v1/rerank", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: RERANK_MODEL, query, documents }),
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as {
      data: { index: number; relevance_score: number }[];
    };
    return json.data
      .map((d) => ({ index: d.index, score: d.relevance_score }))
      .sort((a, b) => b.score - a.score);
  } catch {
    return null;
  }
}
