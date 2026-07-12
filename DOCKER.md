# Local dev with Docker

`docker-compose.yml` runs the two stateful services the app needs — **Postgres
(with pgvector)** and **Redis** — so you can develop locally without cloud
Neon/Redis. The Next.js app itself runs on the host.

The cloud-only services (Voyage embeddings, Vercel Blob, AI Gateway) can't be
containerized — keep those env vars pointing at their real endpoints.

## 1. Start the services

```bash
docker compose up -d
```

Postgres → `localhost:5433` (user `postgres`, password `postgres`, db `rag`)
Redis → `localhost:6380`

> Host ports are **5433** (Postgres) and **6380** (Redis) so they don't clash
> with a Postgres/Redis you may already run locally on 5432/6379.

## 2. Point the app at them

In `.env.local`, set:

```bash
POSTGRES_URL="postgresql://postgres:postgres@localhost:5433/rag"
REDIS_URL="redis://localhost:6380"
# keep VOYAGE_API_KEY, BLOB_READ_WRITE_TOKEN, AUTH_SECRET, AI Gateway as-is
```

> Note: this is a **fresh, empty** database — separate from your Neon data.
> Documents you uploaded against Neon won't be here; re-upload them.

## 3. Apply the schema

```bash
pnpm db:migrate
```

(The `vector` extension is enabled automatically by
`docker/postgres-init/01-init.sql` on first boot.)

## 4. Run the app

```bash
pnpm dev
```

## Stop / reset

```bash
docker compose down      # stop, keep data
docker compose down -v   # stop and delete all data (fresh start)
```
