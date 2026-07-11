"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

type Rect = { x: number; y: number; w: number; h: number };
type PageData = {
  imageUrl: string;
  width: number;
  height: number;
  rects: Rect[];
};

/**
 * Fast source viewer: shows server-rendered page images (cached) and overlays
 * highlight boxes on the retrieved passages. Steps through the cited pages.
 */
export function PdfImageViewer({
  documentId,
  citedPages,
  chunkIdsByPage,
}: {
  documentId: string;
  citedPages: number[];
  chunkIdsByPage: Record<number, string[]>;
}) {
  const pages = citedPages.length > 0 ? citedPages : [1];
  const [index, setIndex] = useState(0);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const page = pages[Math.min(index, pages.length - 1)];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const chunks = (chunkIdsByPage[page] ?? []).join(",");
        const res = await fetch(
          `/api/documents/${documentId}/page/${page}?chunks=${chunks}`
        );
        if (!res.ok) {
          throw new Error(`Failed to render page (${res.status})`);
        }
        const json = (await res.json()) as PageData;
        if (!cancelled) {
          setData(json);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to render");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, page, chunkIdsByPage]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-center gap-3 text-sm">
        <button
          aria-label="Previous source"
          className="rounded-md p-1 hover:bg-muted disabled:opacity-40"
          disabled={index <= 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          type="button"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="tabular-nums text-muted-foreground">
          Page {page}
          {pages.length > 1 ? ` · source ${index + 1} of ${pages.length}` : ""}
        </span>
        <button
          aria-label="Next source"
          className="rounded-md p-1 hover:bg-muted disabled:opacity-40"
          disabled={index >= pages.length - 1}
          onClick={() => setIndex((i) => Math.min(pages.length - 1, i + 1))}
          type="button"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 bg-muted/40 p-2">
        {error ? (
          <p className="p-4 text-red-500 text-sm">{error}</p>
        ) : (
          <div className="relative mx-auto w-fit">
            {data ? (
              // biome-ignore lint/performance/noImgElement: rendered blob image, not a static asset
              <img
                alt={`Page ${page}`}
                className="block max-w-full rounded shadow-sm"
                src={data.imageUrl}
              />
            ) : null}
            {data?.rects.map((r, i) => (
              <div
                className="pointer-events-none absolute rounded-[1px] bg-amber-300/40 ring-1 ring-amber-500/50 mix-blend-multiply dark:mix-blend-screen"
                // biome-ignore lint/suspicious/noArrayIndexKey: positional highlight boxes
                key={i}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                }}
              />
            ))}
            {loading ? (
              <div className="absolute inset-0 grid place-items-center bg-background/40 text-muted-foreground text-sm">
                Rendering…
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
