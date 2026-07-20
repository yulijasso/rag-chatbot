import { AlertTriangle, ArrowLeft, ThumbsDown } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { auth } from "@/app/(auth)/auth";
import {
  MessageSources,
  type SearchResult,
} from "@/components/imcc/message-sources";
import { getDownvotedFeedback } from "@/lib/db/feedback";

/**
 * Feedback review queue — the downvoted answers, each with the question and the
 * sources the assistant retrieved. This is where 👎 clicks become actionable:
 * answers with no sources reveal knowledge-base gaps to fill.
 */
export default function FeedbackPage() {
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
          <Link
            className="transition-colors hover:text-foreground"
            href="/dashboard"
          >
            Knowledge base
          </Link>
        </div>
        <h1 className="mt-3 font-semibold text-2xl tracking-tight">Feedback</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Answers you downvoted, with what the assistant retrieved. No sources
          usually means a knowledge-base gap.
        </p>
      </header>

      <Suspense fallback={<Skeleton />}>
        <Content />
      </Suspense>
    </main>
  );
}

async function Content() {
  const session = await auth();
  if (!session?.user?.id) {
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

  const items = await getDownvotedFeedback(session.user.id);

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-border/50 border-dashed py-10 text-center text-muted-foreground text-sm">
        No downvoted answers yet. When you 👎 an answer in chat, it shows up
        here for review.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => {
        const usable = item.sources
          .filter((s) => s.documentId && s.chunkId)
          .map<SearchResult>((s) => ({
            source: s.source,
            documentId: s.documentId as string,
            chunkId: s.chunkId as string,
            page: s.page,
            excerpt: "",
            score: 0,
          }));

        return (
          <article
            className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
            key={item.messageId}
          >
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <ThumbsDown className="size-3.5" />
              <span>Downvoted</span>
              <span className="ml-auto tabular-nums">
                {new Date(item.createdAt).toLocaleDateString()}
              </span>
            </div>

            {item.question ? (
              <div>
                <span className="text-muted-foreground text-xs">Question</span>
                <p className="mt-0.5 font-medium text-sm">{item.question}</p>
              </div>
            ) : null}

            {item.answer ? (
              <div>
                <span className="text-muted-foreground text-xs">Answer</span>
                <p className="mt-0.5 line-clamp-4 text-muted-foreground text-sm">
                  {item.answer}
                </p>
              </div>
            ) : null}

            {usable.length > 0 ? (
              <MessageSources results={usable} />
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-700 text-xs dark:text-amber-400">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>
                  No sources retrieved — likely a knowledge-base gap.{" "}
                  <Link
                    className="underline underline-offset-2"
                    href="/dashboard"
                  >
                    Upload a document
                  </Link>
                </span>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1, 2].map((i) => (
        <div
          className="h-40 animate-pulse rounded-xl border border-border/60 bg-card"
          key={i}
        />
      ))}
    </div>
  );
}
