# AI layer — implement the LangChain.js RAG/agent here

The rest of the app (DB, tenancy, ingestion, dashboard, chat UI) is scaffolded.
This folder is the seam you own. Three files, in order:

1. **`embeddings.ts`** — export a configured LangChain embeddings instance
   (Voyage `voyage-3`, 1024 dims to match `KnowledgeChunk.embedding`).

2. **`tools.ts`** — `makeTools({ orgId, clientId })` already returns three
   org/client-scoped functions. Wrap each as a LangChain `tool(...)` with a Zod
   schema:
   - `metricsQuery` — structured numbers (SQL over `MetricsDaily`)
   - `vectorRetrieve` — pgvector cosine search over `KnowledgeChunk`
   - `clientContext` — the client's objectives
   **Security:** the scope is captured in a closure — never let the model pass
   its own `orgId`/`clientId`.

3. **`agent.ts`** — `streamAssistant({ scope, messages })` is where you build the
   `ChatAnthropic` model (`claude-sonnet-5` via the AI Gateway), attach the
   tools, and return a stream.

## Wiring into the chat route

In `app/(chat)/api/chat/route.ts`, call `streamAssistant(...)` and pipe it back
with the AI SDK's `LangChainAdapter` (`toDataStreamResponse()`), so the template's
existing chat UI + message persistence keep working unchanged.

## Model IDs

Use the `claude-api` skill to confirm current Claude model IDs/params before
wiring the model. Plan defaults: `claude-sonnet-5` (chat/analysis),
`claude-opus-4-8` (optional, campaign recommendations).
