"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PdfImageViewer } from "./pdf-image-viewer";

type Chunk = {
  id: string;
  content: string;
  pageNumber: number | null;
  chunkIndex: number | null;
};

/**
 * Opens a source document and shows where the answer came from. For PDFs it
 * renders the actual file (native browser viewer) opened to the first cited
 * page, with a clickable list of retrieved passages that jump the viewer to
 * their page. For non-PDFs it shows the extracted text with the used passages
 * highlighted.
 */
export function SourceViewer({
  documentId,
  title,
  highlightChunkIds,
  children,
}: {
  documentId: string;
  title: string;
  highlightChunkIds: string[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const highlighted = useMemo(
    () => new Set(highlightChunkIds),
    [highlightChunkIds]
  );
  const isPdf = /\.pdf$/i.test(title);

  // Fetch chunks the first time the viewer opens.
  useEffect(() => {
    if (!open || chunks) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/chunks`);
        if (!res.ok) {
          throw new Error(`Failed to load document (${res.status})`);
        }
        const data = (await res.json()) as { chunks: Chunk[] };
        if (!cancelled) {
          setChunks(data.chunks);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, chunks, documentId]);

  // Retrieved passages (the highlighted chunks), in document order.
  const hits = useMemo(
    () => (chunks ?? []).filter((c) => highlighted.has(c.id)),
    [chunks, highlighted]
  );

  // Retrieved chunk ids grouped by page, and the sorted list of cited pages.
  const chunkIdsByPage = useMemo(() => {
    const acc: Record<number, string[]> = {};
    for (const h of hits) {
      const p = h.pageNumber ?? 1;
      acc[p] ??= [];
      acc[p].push(h.id);
    }
    return acc;
  }, [hits]);
  const citedPages = useMemo(
    () =>
      Object.keys(chunkIdsByPage)
        .map(Number)
        .sort((a, b) => a - b),
    [chunkIdsByPage]
  );

  // In text mode, scroll the first highlight into view (only one dialog is open
  // at a time, so a document query is safe).
  useEffect(() => {
    if (open && chunks && !isPdf) {
      const id = window.setTimeout(() => {
        document
          .querySelector('[data-source-first-hit="true"]')
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 120);
      return () => window.clearTimeout(id);
    }
  }, [open, chunks, isPdf]);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className={cn(
          "flex max-h-[88vh] flex-col",
          isPdf ? "sm:max-w-5xl" : "sm:max-w-2xl"
        )}
      >
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Source document; passages used in the answer are highlighted.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-red-500 text-sm">{error}</p>
        ) : isPdf ? (
          chunks === null ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            <PdfImageViewer
              chunkIdsByPage={chunkIdsByPage}
              citedPages={citedPages}
              documentId={documentId}
            />
          )
        ) : (
          <TextView chunks={chunks} highlighted={highlighted} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TextView({
  chunks,
  highlighted,
}: {
  chunks: Chunk[] | null;
  highlighted: Set<string>;
}) {
  let seenFirstHighlight = false;

  return (
    <div className="-mx-1 flex-1 overflow-y-auto px-1">
      {chunks === null ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : chunks.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No extracted text for this document.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {chunks.map((chunk) => {
            const isHit = highlighted.has(chunk.id);
            const setRef = isHit && !seenFirstHighlight;
            if (setRef) {
              seenFirstHighlight = true;
            }
            return (
              <div
                className={cn(
                  "scroll-mt-4 whitespace-pre-wrap rounded-md px-3 py-2 text-sm leading-relaxed",
                  isHit
                    ? "bg-amber-200/60 ring-1 ring-amber-400/60 dark:bg-amber-400/15 dark:ring-amber-300/30"
                    : "text-muted-foreground"
                )}
                data-source-first-hit={setRef ? "true" : undefined}
                key={chunk.id}
              >
                {chunk.pageNumber == null ? null : (
                  <span className="mr-2 select-none font-medium text-muted-foreground text-xs">
                    p.{chunk.pageNumber}
                  </span>
                )}
                {chunk.content}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
