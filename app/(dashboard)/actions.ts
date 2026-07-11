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
