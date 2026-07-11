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

/**
 * Embed a batch of texts.
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

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Voyage embeddings failed (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as VoyageResponse;
  // Preserve input order (Voyage returns an `index` per item).
  const ordered = new Array<number[] | null>(texts.length).fill(null);
  for (const item of json.data) {
    ordered[item.index] = item.embedding;
  }
  return ordered;
}

/** Embed a single query string for similarity search. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const [vec] = await embedTexts([text], "query");
  return vec ?? null;
}
