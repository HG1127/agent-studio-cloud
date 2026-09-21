import { config } from "dotenv";

// Workflow 集成测试需要真实数据库与 mock 模型：显式加载 .env.local（vitest 不会自动读取 Next.js env 文件）
config({ path: ".env.local" });
