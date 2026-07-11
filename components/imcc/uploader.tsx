"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type ClientOption = { id: string; name: string };

type Result =
  | { ok: true; type: "metrics"; parsedRows: number; ingestedRows: number }
  | { ok: true; type: "knowledge"; chunks: number; embedded: boolean }
  | { error: string };

const PLATFORMS = [
  { value: "seller_center", label: "Seller Center (sales)" },
  { value: "ads_manager", label: "Ads Manager (ads)" },
  { value: "affiliate_center", label: "Affiliate Center" },
  { value: "business_suite", label: "Business Suite (engagement)" },
  { value: "other", label: "Other" },
];

const KINDS = [
  { value: "brief", label: "Client brief" },
  { value: "strategy_note", label: "Strategy note" },
  { value: "campaign_writeup", label: "Campaign write-up" },
  { value: "best_practice", label: "Best practice" },
];

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2 text-sm";

/** Upload a CSV (→ metrics) or PDF/DOCX (→ knowledge) for a client. */
export function Uploader({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [platform, setPlatform] = useState("seller_center");
  const [kind, setKind] = useState("strategy_note");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const isCsv = useMemo(
    () => (file ? file.name.toLowerCase().endsWith(".csv") : true),
    [file]
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(file && clientId)) {
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("clientId", clientId);
      body.set("platform", platform);
      body.set("kind", kind);
      const res = await fetch("/api/ingest", { method: "POST", body });
      const json = (await res.json()) as Result;
      setResult(json);
      if ("ok" in json) {
        router.refresh();
      }
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Upload failed" });
    } finally {
      setBusy(false);
    }
  }

  if (clients.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Add a client first, then upload data for it.
      </p>
    );
  }

  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Client"
          className={selectClass}
          onChange={(e) => setClientId(e.target.value)}
          value={clientId}
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        {isCsv ? (
          <select
            aria-label="Platform"
            className={selectClass}
            onChange={(e) => setPlatform(e.target.value)}
            value={platform}
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <select
            aria-label="Document kind"
            className={selectClass}
            onChange={(e) => setKind(e.target.value)}
            value={kind}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        )}

        <input
          accept=".csv,.pdf,.docx,.txt,.md"
          className="text-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          type="file"
        />

        <Button disabled={busy || !file} type="submit">
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </div>

      <p className="text-muted-foreground text-xs">
        CSV → performance metrics · PDF/DOCX/TXT → knowledge for the assistant
      </p>

      {result ? (
        "error" in result ? (
          <p className="text-red-500 text-sm">Error: {result.error}</p>
        ) : result.type === "metrics" ? (
          <p className="text-green-600 text-sm">
            Ingested {result.ingestedRows} metric rows (of {result.parsedRows}{" "}
            parsed).
          </p>
        ) : (
          <p className="text-green-600 text-sm">
            Stored {result.chunks} chunks
            {result.embedded ? " (embedded)" : " (embedding pending — add VOYAGE_API_KEY)"}.
          </p>
        )
      ) : null}
    </form>
  );
}
