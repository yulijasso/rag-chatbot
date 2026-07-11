import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import {
  type DocProgress,
  KnowledgeBase,
} from "@/components/imcc/knowledge-base";
import { getOrgContext } from "@/lib/auth/org";
import { scopedDb } from "@/lib/db/scoped";

/**
 * Knowledge base — upload documents that ground the chatbot's answers.
 *
 * Auth/DB-dependent content reads cookies, so it lives inside a <Suspense>
 * boundary as required by Next.js Cache Components. Ingestion runs in the
 * background (see /api/cron/embed); the client shell shows live progress.
 */
export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6 md:p-10">
      <header>
        <div className="flex items-center gap-3 text-muted-foreground text-sm">
          <Link
            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            href="/"
          >
            <ArrowLeft className="size-3.5" />
            Back to chat
          </Link>
          <span>·</span>
          <Link className="transition-colors hover:text-foreground" href="/feedback">
            Feedback
          </Link>
        </div>
        <h1 className="mt-3 font-semibold text-2xl tracking-tight">
          Knowledge base
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Upload documents to ground the assistant's answers.
        </p>
      </header>

      <Suspense fallback={<Skeleton />}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const ctx = await getOrgContext();

  if (!ctx) {
    return (
      <p className="text-muted-foreground text-sm">
        Please{" "}
        <Link className="underline underline-offset-4" href="/login">
          sign in
        </Link>{" "}
        to continue.
      </p>
    );
  }

  const rows = await scopedDb(ctx.orgId).listDocumentsWithProgress();
  const initialDocs: DocProgress[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    total: r.total,
    embedded: r.embedded,
  }));

  return <KnowledgeBase initialDocs={initialDocs} />;
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="h-40 animate-pulse rounded-xl border border-border/60 border-dashed" />
      <div className="h-24 animate-pulse rounded-xl border border-border/60" />
    </div>
  );
}
