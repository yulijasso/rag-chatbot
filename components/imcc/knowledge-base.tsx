"use client";

import { FileText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DeleteDocumentButton } from "@/components/imcc/delete-document-button";
import { Uploader } from "@/components/imcc/uploader";

export type DocProgress = {
  id: string;
  title: string;
  status: "queued" | "embedding" | "completed" | "failed";
  error: string | null;
  createdAt: string;
  total: number;
  embedded: number;
};

const isPending = (d: DocProgress) =>
  d.status === "queued" || d.status === "embedding";

/**
 * Client shell for the knowledge base: renders the uploader + document list,
 * and while any document is still processing it drives the background worker
 * (POST /api/cron/embed) and polls status until everything is embedded. This
 * makes ingestion progress on any Vercel plan without waiting for the cron.
 */
export function KnowledgeBase({ initialDocs }: { initialDocs: DocProgress[] }) {
  const [docs, setDocs] = useState<DocProgress[]>(initialDocs);
  const drivingRef = useRef(false);

  const refresh = useCallback(async (): Promise<DocProgress[]> => {
    const res = await fetch("/api/documents");
    if (!res.ok) {
      return docs;
    }
    const { documents } = (await res.json()) as { documents: DocProgress[] };
    setDocs(documents);
    return documents;
  }, [docs]);

  const pending = docs.some(isPending);

  // Drive the worker to completion whenever something is pending.
  useEffect(() => {
    if (!pending || drivingRef.current) {
      return;
    }
    drivingRef.current = true;
    let cancelled = false;

    (async () => {
      let more = true;
      // Guard against a runaway loop; each pass advances a bounded batch.
      for (let guard = 0; !cancelled && more && guard < 5000; guard++) {
        try {
          await fetch("/api/cron/embed", { method: "POST" });
        } catch {
          // Network hiccup — retry on the next pass.
        }
        if (cancelled) {
          break;
        }
        const latest = await refresh();
        more = latest.some(isPending);
      }
      drivingRef.current = false;
    })();

    return () => {
      cancelled = true;
      drivingRef.current = false;
    };
  }, [pending, refresh]);

  return (
    <div className="flex flex-col gap-8">
      <Uploader onUploaded={refresh} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-base">Documents</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs tabular-nums">
            {docs.length}
          </span>
        </div>

        {docs.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-xl border border-border/60 border-dashed py-12 text-center">
            <FileText className="size-6 text-muted-foreground/60" />
            <p className="mt-1 font-medium text-sm">No documents yet</p>
            <p className="text-muted-foreground text-xs">
              Upload one above to ground the assistant.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {docs.map((doc) => (
              <DocumentRow
                doc={doc}
                key={doc.id}
                onDeleted={() =>
                  setDocs((prev) => prev.filter((d) => d.id !== doc.id))
                }
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DocumentRow({
  doc,
  onDeleted,
}: {
  doc: DocProgress;
  onDeleted: () => void;
}) {
  const pct = doc.total > 0 ? Math.round((doc.embedded / doc.total) * 100) : 0;

  return (
    <li className="group flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-3.5 shadow-[var(--shadow-card)] transition-colors hover:border-border">
      <div className="flex items-center gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">{doc.title}</p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {doc.total} {doc.total === 1 ? "chunk" : "chunks"} ·{" "}
            {new Date(doc.createdAt).toLocaleDateString()}
          </p>
        </div>
        <StatusBadge doc={doc} pct={pct} />
        <DeleteDocumentButton
          documentId={doc.id}
          onDeleted={onDeleted}
          title={doc.title}
        />
      </div>

      {doc.status === "embedding" ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${Math.max(pct, 4)}%` }}
          />
        </div>
      ) : null}

      {doc.status === "failed" && doc.error ? (
        <p className="text-red-500 text-xs">{doc.error}</p>
      ) : null}
    </li>
  );
}

function StatusBadge({ doc, pct }: { doc: DocProgress; pct: number }) {
  const config = {
    completed: {
      label: "Ready",
      dot: "bg-green-500",
      cls: "bg-green-500/10 text-green-600 dark:text-green-400",
    },
    failed: {
      label: "Failed",
      dot: "bg-red-500",
      cls: "bg-red-500/10 text-red-600 dark:text-red-400",
    },
    queued: {
      label: "Queued",
      dot: "bg-muted-foreground/50",
      cls: "bg-muted text-muted-foreground",
    },
    embedding: {
      label: `Embedding ${pct}%`,
      dot: "bg-amber-500 animate-pulse",
      cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
  }[doc.status];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs tabular-nums ${config.cls}`}
    >
      <span className={`size-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
