import "server-only";

/**
 * Document → text → chunks, for the RAG knowledge corpus.
 *
 * PDFs are parsed with `unpdf` (serverless-friendly, no native deps) and DOCX
 * with `mammoth`. Plain-text/markdown pass through. Extracted text is split
 * into overlapping chunks ready to embed into `KnowledgeChunk`.
 */

export type KnowledgeKind =
  | "brief"
  | "strategy_note"
  | "campaign_writeup"
  | "best_practice";

export type DocFileType = "pdf" | "docx" | "text";

/** Classify an upload by extension / MIME type. */
export function classifyDocument(
  filename: string,
  mimeType?: string
): DocFileType | null {
  const name = filename.toLowerCase();
  if (name.endsWith(".pdf") || mimeType === "application/pdf") {
    return "pdf";
  }
  if (
    name.endsWith(".docx") ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (name.endsWith(".txt") || name.endsWith(".md") || mimeType === "text/plain") {
    return "text";
  }
  return null;
}

/** Extract plain text from a supported document buffer. */
export async function extractText(
  buffer: ArrayBuffer,
  type: DocFileType
): Promise<string> {
  if (type === "pdf") {
    const { extractText: extract, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extract(pdf, { mergePages: true });
    return text;
  }
  if (type === "docx") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(buffer),
    });
    return value;
  }
  // text / markdown
  return new TextDecoder().decode(buffer);
}

/**
 * Split text into overlapping chunks on paragraph/sentence boundaries.
 * ~1000 chars per chunk with ~150 char overlap keeps related context together
 * without exceeding embedding limits.
 */
export function chunkText(
  text: string,
  { maxChars = 1000, overlap = 150 }: { maxChars?: number; overlap?: number } = {}
): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) {
    return [];
  }

  // Prefer to break on paragraph boundaries, falling back to hard slicing.
  const paragraphs = clean.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  const push = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push(trimmed);
    }
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      // Paragraph too big on its own — hard-slice it with overlap.
      push();
      current = "";
      for (let i = 0; i < para.length; i += maxChars - overlap) {
        chunks.push(para.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (current.length + para.length + 2 > maxChars) {
      push();
      // Carry a tail of the previous chunk forward as overlap.
      current = current.slice(-overlap) + "\n\n" + para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  push();

  return chunks.filter(Boolean);
}
