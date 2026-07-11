"use server";

import { revalidatePath } from "next/cache";
import { requireOrgContext } from "@/lib/auth/org";
import { scopedDb } from "@/lib/db/scoped";

/** Create a new client workspace for the caller's org. */
export async function createClientAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const objectives = String(formData.get("objectives") ?? "").trim();
  if (!name) {
    return { error: "Client name is required" };
  }

  const ctx = await requireOrgContext();
  const sdb = scopedDb(ctx.orgId);
  await sdb.createClient({ name, objectives: objectives || null });

  revalidatePath("/dashboard");
  return { ok: true };
}

/** Delete a knowledge document (cascades to its embedded chunks). */
export async function deleteKnowledgeDocumentAction(documentId: string) {
  if (!documentId) {
    return { error: "documentId is required" };
  }

  const ctx = await requireOrgContext();
  const [deleted] = await scopedDb(ctx.orgId).deleteKnowledgeDocument(
    documentId
  );
  if (!deleted) {
    return { error: "Document not found" };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
