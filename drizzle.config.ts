import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// drizzle-kit 不会自动读取 Next 的 .env.local，必须显式加载
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema/*.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
