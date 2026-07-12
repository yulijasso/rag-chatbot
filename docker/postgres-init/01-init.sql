-- Runs once when the Postgres container's data dir is first created.
-- Enables pgvector so the KnowledgeChunk.embedding column + HNSW index work.
CREATE EXTENSION IF NOT EXISTS vector;
