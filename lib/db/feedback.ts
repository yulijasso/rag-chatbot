import "server-only";

import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "./client";
import { chat, message, vote } from "./schema";

export type FeedbackSource = {
  source: string;
  documentId?: string;
  chunkId?: string;
  page?: number;
};

export type FeedbackItem = {
  messageId: string;
  chatId: string;
  createdAt: Date;
  question: string;
  answer: string;
  sources: FeedbackSource[];
};

type Part =
  | { type: "text"; text?: string }
  | {
      type: string;
      state?: string;
      output?: { results?: FeedbackSource[] } | { error: string };
    };

function textOf(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }
  return (parts as Part[])
    .filter((p): p is { type: "text"; text?: string } => p.type === "text")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
}

function sourcesOf(parts: unknown): FeedbackSource[] {
  if (!Array.isArray(parts)) {
    return [];
  }
  const out: FeedbackSource[] = [];
  for (const p of parts as Part[]) {
    if (
      p.type === "tool-searchKnowledge" &&
      "output" in p &&
      p.output &&
      "results" in p.output &&
      Array.isArray(p.output.results)
    ) {
      out.push(...p.output.results);
    }
  }
  return out;
}

/**
 * Downvoted assistant answers for a user's chats, with the question that
 * prompted them and the sources the assistant retrieved. Answers with no
 * sources are likely knowledge-base gaps; answers with sources but still
 * downvoted point at bad retrieval or a bad answer.
 */
export async function getDownvotedFeedback(
  userId: string,
  limit = 50
): Promise<FeedbackItem[]> {
  const rows = await db
    .select({
      messageId: message.id,
      chatId: message.chatId,
      parts: message.parts,
      createdAt: message.createdAt,
    })
    .from(vote)
    .innerJoin(message, eq(vote.messageId, message.id))
    .innerJoin(chat, eq(vote.chatId, chat.id))
    .where(
      and(
        eq(chat.userId, userId),
        eq(vote.isUpvoted, false),
        eq(message.role, "assistant")
      )
    )
    .orderBy(desc(message.createdAt))
    .limit(limit);

  const items: FeedbackItem[] = [];
  for (const row of rows) {
    // The question is the most recent user message before this answer.
    const [q] = await db
      .select({ parts: message.parts })
      .from(message)
      .where(
        and(
          eq(message.chatId, row.chatId),
          eq(message.role, "user"),
          lt(message.createdAt, row.createdAt)
        )
      )
      .orderBy(desc(message.createdAt))
      .limit(1);

    items.push({
      messageId: row.messageId,
      chatId: row.chatId,
      createdAt: row.createdAt,
      question: q ? textOf(q.parts) : "",
      answer: textOf(row.parts),
      sources: sourcesOf(row.parts),
    });
  }
  return items;
}
