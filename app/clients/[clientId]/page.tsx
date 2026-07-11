/**
 * Client Intelligence Workspace (SHELL).
 *
 * Everything on this route is scoped to one client: dashboard, insights,
 * recommendations, uploads, and the chat assistant.
 *
 * TODO: resolve orgId (auth), verify the client belongs to the org via
 * scopedDb(orgId).getClient(clientId), then render the per-client view.
 */
export default async function ClientWorkspacePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  return (
    <main className="mx-auto max-w-6xl p-8">
      <h1 className="font-semibold text-2xl">Client workspace</h1>
      <p className="mt-2 text-muted-foreground text-sm">
        Client: <code>{clientId}</code>. TODO: scoped dashboard, insights,
        recommendations, uploads, and chat.
      </p>
    </main>
  );
}
