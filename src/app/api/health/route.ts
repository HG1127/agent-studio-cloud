import { sql } from "drizzle-orm";
import { HealthResponse } from "@/contracts/health";
import { db } from "@/lib/db";

export async function GET() {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const body = HealthResponse.parse({ ok: dbOk, db: dbOk, workflow: true });
  return Response.json(body, { status: dbOk ? 200 : 503 });
}
