ALTER TABLE "KnowledgeDocument" ADD COLUMN "status" varchar DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "KnowledgeDocument" ADD COLUMN "error" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "KnowledgeDocument_status_idx" ON "KnowledgeDocument" USING btree ("status");