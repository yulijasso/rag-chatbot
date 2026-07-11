import type { InferSelectModel } from "drizzle-orm";
import {
  date,
  index,
  integer,
  json,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
  vector,
} from "drizzle-orm/pg-core";
import { user } from "./schema";

/**
 * Intelligent Marketing Command Center domain schema.
 *
 * Multi-tenancy is enforced at the application layer: every row here carries an
 * `orgId` (and, where relevant, a `clientId`). All access must go through the
 * `scopedDb(orgId)` helper (lib/db/scoped.ts) so no query can forget to filter.
 */

// ---------------------------------------------------------------------------
// Tenancy: the agency (organization) and its team members.
// Auth.js has no built-in orgs, so we model them ourselves on top of `user`.
// ---------------------------------------------------------------------------

export const organization = pgTable("Organization", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});
export type Organization = InferSelectModel<typeof organization>;

export const membership = pgTable(
  "Membership",
  {
    orgId: uuid("orgId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: varchar("role", { enum: ["owner", "account_manager"] })
      .notNull()
      .default("account_manager"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.orgId, table.userId] }),
  })
);
export type Membership = InferSelectModel<typeof membership>;

// ---------------------------------------------------------------------------
// Clients: the brands the agency manages. One intelligence workspace per client.
// ---------------------------------------------------------------------------

export const client = pgTable(
  "Client",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Free-form objectives / context used to ground recommendations + chat.
    objectives: text("objectives"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("Client_org_idx").on(table.orgId),
  })
);
export type Client = InferSelectModel<typeof client>;

// ---------------------------------------------------------------------------
// Dimension tables: products, creators, campaigns.
// ---------------------------------------------------------------------------

export const product = pgTable(
  "Product",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId").notNull(),
    clientId: uuid("clientId")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    externalId: varchar("externalId", { length: 128 }),
    name: text("name").notNull(),
  },
  (table) => ({
    clientIdx: index("Product_client_idx").on(table.clientId),
  })
);
export type Product = InferSelectModel<typeof product>;

export const creator = pgTable(
  "Creator",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId").notNull(),
    clientId: uuid("clientId")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    externalId: varchar("externalId", { length: 128 }),
    handle: text("handle").notNull(),
  },
  (table) => ({
    clientIdx: index("Creator_client_idx").on(table.clientId),
  })
);
export type Creator = InferSelectModel<typeof creator>;

export const campaign = pgTable(
  "Campaign",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId").notNull(),
    clientId: uuid("clientId")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    externalId: varchar("externalId", { length: 128 }),
    name: text("name").notNull(),
  },
  (table) => ({
    clientIdx: index("Campaign_client_idx").on(table.clientId),
  })
);
export type Campaign = InferSelectModel<typeof campaign>;

// ---------------------------------------------------------------------------
// Fact table: one normalized daily metric row per (client, date, platform,
// metricType, dimension). Values are stored generically so any platform's
// export can be normalized into the same shape.
// ---------------------------------------------------------------------------

export const metricsDaily = pgTable(
  "MetricsDaily",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId").notNull(),
    clientId: uuid("clientId")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    platform: varchar("platform", {
      enum: [
        "seller_center",
        "ads_manager",
        "affiliate_center",
        "business_suite",
        "other",
      ],
    }).notNull(),
    metricType: varchar("metricType", {
      enum: ["sales", "ads", "affiliate", "creator", "content", "engagement"],
    }).notNull(),
    // Optional dimension the row is broken down by.
    dimension: varchar("dimension", {
      enum: ["product", "creator", "campaign", "none"],
    })
      .notNull()
      .default("none"),
    dimensionId: uuid("dimensionId"),
    dimensionName: text("dimensionName"),
    // Generic value columns (nullable — only the relevant ones are populated).
    revenue: numeric("revenue"),
    spend: numeric("spend"),
    roas: numeric("roas"),
    orders: integer("orders"),
    units: integer("units"),
    impressions: integer("impressions"),
    clicks: integer("clicks"),
    gmv: numeric("gmv"),
    commission: numeric("commission"),
    engagementRate: numeric("engagementRate"),
    uploadId: uuid("uploadId"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    clientDateIdx: index("MetricsDaily_client_date_idx").on(
      table.clientId,
      table.date
    ),
    typeIdx: index("MetricsDaily_type_idx").on(
      table.clientId,
      table.metricType
    ),
  })
);
export type MetricsDaily = InferSelectModel<typeof metricsDaily>;

// ---------------------------------------------------------------------------
// Ingestion audit: one row per uploaded file.
// ---------------------------------------------------------------------------

export const upload = pgTable(
  "Upload",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId").notNull(),
    clientId: uuid("clientId")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    blobUrl: text("blobUrl"),
    platform: varchar("platform").notNull(),
    status: varchar("status", {
      enum: ["pending", "processing", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    rowsIngested: integer("rowsIngested").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    clientIdx: index("Upload_client_idx").on(table.clientId),
  })
);
export type Upload = InferSelectModel<typeof upload>;

// ---------------------------------------------------------------------------
// Unstructured knowledge for RAG. Named "Knowledge*" to avoid colliding with
// the template's chat-artifact `Document` table.
// ---------------------------------------------------------------------------

export const knowledgeDocument = pgTable(
  "KnowledgeDocument",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId").notNull(),
    // Nullable: agency-wide best-practices vs client-specific briefs/notes.
    clientId: uuid("clientId").references(() => client.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    kind: varchar("kind", {
      enum: ["brief", "strategy_note", "campaign_writeup", "best_practice"],
    })
      .notNull()
      .default("strategy_note"),
    source: text("source"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("KnowledgeDocument_org_idx").on(table.orgId),
  })
);
export type KnowledgeDocument = InferSelectModel<typeof knowledgeDocument>;

export const knowledgeChunk = pgTable(
  "KnowledgeChunk",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId").notNull(),
    clientId: uuid("clientId"),
    documentId: uuid("documentId")
      .notNull()
      .references(() => knowledgeDocument.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    // Voyage voyage-3 = 1024 dims. Change if the embedding model changes.
    embedding: vector("embedding", { dimensions: 1024 }),
    metadata: json("metadata"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("KnowledgeChunk_org_idx").on(table.orgId),
    embeddingIdx: index("KnowledgeChunk_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  })
);
export type KnowledgeChunk = InferSelectModel<typeof knowledgeChunk>;

// ---------------------------------------------------------------------------
// Intelligence outputs: insights/alerts, recommendations, and the learning loop.
// ---------------------------------------------------------------------------

export const insight = pgTable(
  "Insight",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId").notNull(),
    clientId: uuid("clientId")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    type: varchar("type", {
      enum: ["trend", "anomaly", "opportunity", "risk"],
    }).notNull(),
    severity: varchar("severity", {
      enum: ["info", "warning", "critical"],
    })
      .notNull()
      .default("info"),
    title: text("title").notNull(),
    detail: text("detail"),
    payload: json("payload"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    clientIdx: index("Insight_client_idx").on(table.clientId),
  })
);
export type Insight = InferSelectModel<typeof insight>;

export const recommendation = pgTable(
  "Recommendation",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId").notNull(),
    clientId: uuid("clientId")
      .notNull()
      .references(() => client.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    rationale: text("rationale"),
    // Structured recommendation body (actions, target creators/products,
    // budget hint, success metrics) validated by Zod before insert.
    body: json("body"),
    status: varchar("status", {
      enum: ["proposed", "accepted", "rejected"],
    })
      .notNull()
      .default("proposed"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    clientIdx: index("Recommendation_client_idx").on(table.clientId),
  })
);
export type Recommendation = InferSelectModel<typeof recommendation>;

export const decision = pgTable(
  "Decision",
  {
    id: uuid("id").primaryKey().notNull().defaultRandom(),
    orgId: uuid("orgId").notNull(),
    recommendationId: uuid("recommendationId")
      .notNull()
      .references(() => recommendation.id, { onDelete: "cascade" }),
    userId: uuid("userId").references(() => user.id),
    action: varchar("action", {
      enum: ["accepted", "rejected", "modified"],
    }).notNull(),
    outcome: text("outcome"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => ({
    recIdx: index("Decision_rec_idx").on(table.recommendationId),
  })
);
export type Decision = InferSelectModel<typeof decision>;
