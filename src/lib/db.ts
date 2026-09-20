import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as workspaceSchema from "@/db/schema/workspace";
import * as userSchema from "@/db/schema/user";

const connectionString = process.env.DATABASE_URL_POOLED;
if (!connectionString) throw new Error("缺少 DATABASE_URL_POOLED 环境变量");

// Neon 池化连接（pgbouncer）不支持预编译语句，必须 prepare:false
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, {
  schema: { ...workspaceSchema, ...userSchema },
});
