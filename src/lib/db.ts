import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const connectionString = process.env.DATABASE_URL_POOLED;
if (!connectionString) throw new Error("缺少 DATABASE_URL_POOLED 环境变量");

// Neon 池化连接（pgbouncer）不支持预编译语句，必须 prepare:false；
// 空闲会断连：主动回收连接，避免长轮询与审批恢复首查撞 ECONNRESET（终审⑰）；
// connect_timeout 给足 30s：跨境到 Neon 冷启动+握手偶发超 10s（本地开发实测），生产与 Neon 同区域无此问题
const client = postgres(connectionString, {
  prepare: false,
  idle_timeout: 30,
  max_lifetime: 60 * 5,
  connect_timeout: 30,
});

export const db = drizzle(client, { schema });
