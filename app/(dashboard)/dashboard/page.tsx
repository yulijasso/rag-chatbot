import Link from "next/link";
import { Suspense } from "react";
import { CreateClientForm } from "@/components/imcc/create-client-form";
import { Uploader } from "@/components/imcc/uploader";
import { getOrgContext } from "@/lib/auth/org";
import { scopedDb } from "@/lib/db/scoped";

/**
 * Unified Marketing Dashboard — agency roll-up.
 *
 * The auth/DB-dependent content is dynamic (reads cookies), so it lives inside
 * a <Suspense> boundary as required by Next.js Cache Components. All data is
 * read through scopedDb(orgId); the org is bootstrapped for the signed-in user
 * on first visit (no seed data).
 */
export default function DashboardPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-8 p-8">
      <header>
        <h1 className="font-semibold text-2xl">Command Center</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Agency roll-up. Create client workspaces and upload their data.
        </p>
      </header>
      <Suspense
        fallback={<p className="text-muted-foreground text-sm">Loading…</p>}
      >
        <DashboardContent />
      </Suspense>
    </main>
  );
}

async function DashboardContent() {
  const ctx = await getOrgContext();

  if (!ctx) {
    return (
      <p className="text-muted-foreground text-sm">
        Please{" "}
        <Link className="underline" href="/login">
          sign in
        </Link>{" "}
        to continue.
      </p>
    );
  }

  const sdb = scopedDb(ctx.orgId);
  const [clients, uploads] = await Promise.all([
    sdb.listClients(),
    sdb.listUploads(),
  ]);
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-lg">Clients</h2>
        <CreateClientForm />
        {clients.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No clients yet. Add one above to get started.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {clients.map((c) => (
              <li key={c.id}>
                <Link
                  className="inline-block rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  href={`/clients/${c.id}`}
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-lg">Upload data</h2>
        <Uploader clients={clients.map((c) => ({ id: c.id, name: c.name }))} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-lg">Recent uploads</h2>
        {uploads.length === 0 ? (
          <p className="text-muted-foreground text-sm">No uploads yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-4 font-medium">File</th>
                  <th className="py-1 pr-4 font-medium">Client</th>
                  <th className="py-1 pr-4 font-medium">Platform</th>
                  <th className="py-1 pr-4 font-medium">Status</th>
                  <th className="py-1 pr-4 font-medium">Rows</th>
                </tr>
              </thead>
              <tbody>
                {uploads.map((u) => (
                  <tr className="border-t" key={u.id}>
                    <td className="py-1 pr-4">{u.filename}</td>
                    <td className="py-1 pr-4">
                      {clientName.get(u.clientId) ?? "—"}
                    </td>
                    <td className="py-1 pr-4">{u.platform}</td>
                    <td className="py-1 pr-4">{u.status}</td>
                    <td className="py-1 pr-4">{u.rowsIngested}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
