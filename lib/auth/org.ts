import "server-only";

import { and, eq } from "drizzle-orm";
import { auth } from "@/app/(auth)/auth";
import { db } from "@/lib/db/client";
import { membership, organization } from "@/lib/db/imcc-schema";

/**
 * Org resolution / onboarding.
 *
 * Auth.js has no concept of organizations, so we model them ourselves. Rather
 * than seed demo orgs, we bootstrap one on demand: the first time a signed-in
 * user touches org-scoped data, they get their own Organization + an `owner`
 * Membership. Everything downstream is then scoped via `scopedDb(orgId)`.
 */

/** Return the user's orgId, creating an Organization + owner Membership if none. */
export async function getOrCreateOrgForUser(
  userId: string,
  orgName = "My Agency"
): Promise<string> {
  const existing = await db
    .select({ orgId: membership.orgId })
    .from(membership)
    .where(eq(membership.userId, userId))
    .limit(1);

  if (existing[0]) {
    return existing[0].orgId;
  }

  const [org] = await db
    .insert(organization)
    .values({ name: orgName })
    .returning({ id: organization.id });

  await db
    .insert(membership)
    .values({ orgId: org.id, userId, role: "owner" })
    // Guard against a race where two requests bootstrap at once.
    .onConflictDoNothing();

  return org.id;
}

export type OrgContext = { userId: string; orgId: string };

/**
 * Resolve the current request's org context, or `null` if unauthenticated.
 * Use in Server Components / route handlers as the entry point to scoped data.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return null;
  }
  const orgId = await getOrCreateOrgForUser(userId);
  return { userId, orgId };
}

/** Like `getOrgContext` but throws if unauthenticated (for mutations). */
export async function requireOrgContext(): Promise<OrgContext> {
  const ctx = await getOrgContext();
  if (!ctx) {
    throw new Error("Unauthorized: no authenticated user");
  }
  return ctx;
}

/** Confirm a membership row exists for (org, user). */
export async function isMember(
  orgId: string,
  userId: string
): Promise<boolean> {
  const rows = await db
    .select({ userId: membership.userId })
    .from(membership)
    .where(and(eq(membership.orgId, orgId), eq(membership.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
