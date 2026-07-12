"use client";

import { FileText } from "lucide-react";
import { SourceViewer } from "@/components/imcc/source-viewer";

export type SearchResult = {
  source: string;
  documentId: string;
  chunkId: string;
  page?: number;
  excerpt: string;
  score: number;
};

/**
 * Renders the passages the assistant retrieved via searchKnowledge as a
 * compact "Sources" list. Clicking a source opens the document with the used
 * passages highlighted.
 */
export function MessageSources({
  results,
  answerText,
}: {
  results: SearchResult[];
  answerText?: string;
}) {
  // Older messages (from before this feature) have no documentId/chunkId — skip
  // them so we never render an un-openable source or fetch an invalid id.
  let usable = (results ?? []).filter((r) => r.documentId && r.chunkId);

  // Show ONLY the sources the assistant actually cited in its answer (it writes
  // "Source: <filename>"). If it cited nothing — e.g. it refused because the
  // answer isn't in the knowledge base — show no sources at all.
  if (answerText) {
    const hay = answerText.toLowerCase();
    usable = usable.filter((r) => {
      const title = r.source.toLowerCase();
      const noExt = title.replace(/\.[a-z0-9]+$/, "");
      return hay.includes(title) || hay.includes(noExt);
    });
  }

  if (usable.length === 0) {
    return null;
  }

  // Group retrieved chunks by document so each source opens once, highlighting
  // all of its retrieved passages.
  const byDoc = new Map<
    string,
    { title: string; chunkIds: string[]; pages: Set<number> }
  >();
  for (const r of usable) {
    const entry = byDoc.get(r.documentId) ?? {
      title: r.source,
      chunkIds: [],
      pages: new Set<number>(),
    };
    entry.chunkIds.push(r.chunkId);
    if (typeof r.page === "number") {
      entry.pages.add(r.page);
    }
    byDoc.set(r.documentId, entry);
  }

  const docs = Array.from(byDoc.entries());

  // Pages the model actually cited for a document in its "Source: <file>, p. N"
  // line — so the chip matches the prose citation, not every retrieved page.
  const citedPagesFor = (title: string): number[] | null => {
    if (!answerText) {
      return null;
    }
    const esc = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = answerText.match(
      new RegExp(`${esc}[^\\n]{0,12}?p{1,2}\\.?\\s*([0-9][0-9,\\s]*)`, "i")
    );
    if (!m) {
      return null;
    }
    const nums = m[1]
      .split(/[^0-9]+/)
      .map(Number)
      .filter((n) => n > 0);
    return nums.length > 0
      ? Array.from(new Set(nums)).sort((a, b) => a - b)
      : null;
  };

  return (
    <div className="mt-2.5 border-border/40 border-t pt-2.5">
      <div className="flex flex-wrap gap-1.5">
        {docs.map(([documentId, doc], i) => {
          const pages =
            citedPagesFor(doc.title) ??
            Array.from(doc.pages).sort((a, b) => a - b);
          return (
            <SourceViewer
              documentId={documentId}
              highlightChunkIds={doc.chunkIds}
              key={documentId}
              title={doc.title}
            >
              <button
                className="group inline-flex max-w-full items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-left text-xs shadow-[var(--shadow-card)] transition-colors hover:border-border hover:bg-muted"
                type="button"
              >
                <span className="grid size-4 shrink-0 place-items-center rounded bg-muted text-[10px] text-muted-foreground tabular-nums group-hover:bg-background">
                  {i + 1}
                </span>
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-[24ch] truncate font-medium">
                  {doc.title}
                </span>
                {pages.length > 0 ? (
                  <span className="shrink-0 text-muted-foreground">
                    p.{pages.slice(0, 3).join(", ")}
                    {pages.length > 3 ? "…" : ""}
                  </span>
                ) : null}
              </button>
            </SourceViewer>
          );
        })}
      </div>
    </div>
  );
}
