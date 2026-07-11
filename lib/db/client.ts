import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Single shared connection, reused across the app (mirrors lib/db/queries.ts).
const connection = postgres(process.env.POSTGRES_URL ?? "");

export const db = drizzle(connection);
export type Database = typeof db;
