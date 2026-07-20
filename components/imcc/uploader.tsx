"use client";

import { upload } from "@vercel/blob/client";
import { Check, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Result = { ok: true; type: "queued" } | { error: string };

/** Generic document uploader — queues a file for the RAG knowledge base. */
export function Uploader({ onUploaded }: { onUploaded?: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "processing">(
    "idle"
  );
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const busy = phase !== "idle";

  const ACCEPTED = [".pdf", ".docx", ".txt", ".md"];

  function acceptFile(candidate: File | null) {
    if (!candidate) {
      return;
    }
    const ok = ACCEPTED.some((ext) =>
      candidate.name.toLowerCase().endsWith(ext)
    );
    if (!ok) {
      setResult({
        error: `Unsupported file type. Use ${ACCEPTED.join(", ")}.`,
      });
      return;
    }
    setResult(null);
    setFile(candidate);
  }

  function onDrop(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files?.[0] ?? null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      return;
    }
    const MAX_MB = 100;
    if (file.size > MAX_MB * 1024 * 1024) {
      setResult({
        error: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB — over the ${MAX_MB}MB limit.`,
      });
      return;
    }
    setResult(null);
    try {
      // 1) Upload the file straight to Vercel Blob — no server body-size cap.
      setPhase("uploading");
      setProgress(0);
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        multipart: true,
        onUploadProgress: (e) => setProgress(e.percentage),
      });

      // 2) Ask the server to extract + embed it from the blob URL.
      setPhase("processing");
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blobUrl: blob.url, filename: file.name }),
      });
      const json = (await res.json().catch(() => null)) as Result | null;
      if (!json) {
        setResult({
          error: `Upload failed (${res.status} ${res.statusText}).`,
        });
        return;
      }
      setResult(json);
      if ("ok" in json) {
        setFile(null);
        if (inputRef.current) {
          inputRef.current.value = "";
        }
        onUploaded?.();
        router.refresh();
      }
    } catch (err) {
      setResult({
        error: err instanceof Error ? err.message : "Upload failed",
      });
    } finally {
      setPhase("idle");
    }
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      {/** biome-ignore lint/a11y/noNoninteractiveElementInteractions: label wraps a real file input for keyboard/AT access; drag handlers are a mouse-only enhancement */}
      <label
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors ${
          dragging
            ? "border-primary bg-primary/5"
            : "border-border/60 bg-background/50 hover:bg-muted/40"
        }`}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDrop={onDrop}
      >
        <div
          className={`grid size-11 place-items-center rounded-full transition-colors ${
            dragging || file
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground"
          }`}
        >
          <UploadCloud className="size-5" />
        </div>
        <span className="text-sm">
          {file ? (
            <span className="font-medium">{file.name}</span>
          ) : (
            <>
              <span className="font-medium text-foreground">Choose a file</span>{" "}
              or drop it here
            </>
          )}
        </span>
        <span className="text-muted-foreground text-xs">
          PDF, DOCX, TXT, or MD · up to 100MB
        </span>
        <input
          accept=".pdf,.docx,.txt,.md"
          className="sr-only"
          onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
          ref={inputRef}
          type="file"
        />
      </label>

      <div className="flex items-center gap-3">
        <Button disabled={busy || !file} type="submit">
          {phase === "uploading"
            ? "Uploading…"
            : phase === "processing"
              ? "Processing…"
              : "Upload"}
        </Button>
        {result && !busy ? (
          "error" in result ? (
            <span className="text-red-500 text-sm">{result.error}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-green-600 text-sm dark:text-green-400">
              <Check className="size-3.5" />
              Queued
            </span>
          )
        ) : null}
      </div>

      {busy ? (
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full bg-primary transition-all duration-200 ${
                phase === "processing" ? "animate-pulse" : ""
              }`}
              style={{
                width:
                  phase === "uploading" ? `${Math.max(progress, 2)}%` : "100%",
              }}
            />
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            {phase === "uploading"
              ? `Uploading ${Math.round(progress)}%`
              : "Processing…"}
          </span>
        </div>
      ) : null}
    </form>
  );
}
