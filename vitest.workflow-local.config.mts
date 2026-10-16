import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";
import { workflow } from "@workflow/vitest";

const root = import.meta.dirname;
const fixtures = path.join(root, "tests/workflow-local/fixtures");
function assertPhysicalAncestors(directory: string) {
  for (let current = directory; ; current = path.dirname(current)) {
    let entry;
    try { entry = lstatSync(current); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) {
      throw new Error("Local SDK paths must have physical directory ancestors");
    }
    if (path.dirname(current) === current) break;
  }
}
for (const directory of [fixtures, path.join(root, ".vitest/workflow-local")]) assertPhysicalAncestors(directory);
if (path.resolve(realpathSync(root)).toLowerCase() !== path.resolve(root).toLowerCase()) {
  throw new Error("Local SDK checkout root must resolve to its owned physical path");
}
const attemptId = process.env.MVP_LOCAL_SDK_ATTEMPT_ID;
if (process.env.MVP_LOCAL_SDK_ONLY !== "1" || !attemptId || !/^[a-f0-9]{32}$/.test(attemptId)) {
  throw new Error("Local SDK verification requires an explicitly owned fresh attempt");
}
const localEnvironment = {
  WORKFLOW_TARGET: "local",
  WORKFLOW_TARGET_WORLD: "local",
  WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS: "0",
  WORKFLOW_LOCAL_QUEUE_CONCURRENCY: "1",
  WORKFLOW_LOCAL_QUEUE_MAX_VISIBILITY: "5",
};
for (const [name, value] of Object.entries(localEnvironment)) {
  if (process.env[name] !== value) throw new Error("Local SDK runtime environment was not isolated");
}
for (const name of Object.keys(process.env)) {
  if (/^(DATABASE_|NEON_|VERCEL(?:_|$)|WORKFLOW_VERCEL_)/i.test(name)
    || /^(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|PGSERVICE|PGSSLMODE|MVP_ACCEPTANCE_ISOLATED_DB|NODE_PATH)$/i.test(name)
    || /(?:API_KEY|AUTH_TOKEN|ENCRYPTION_KEY|SECRET)$/i.test(name)
    || (name.startsWith("WORKFLOW_") && !(name in localEnvironment))) {
    throw new Error("Business, remote or unreviewed runtime environment is forbidden");
  }
}
for (const name of [".env", ".env.local", ".env.test", ".env.test.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local"]) {
  if (existsSync(path.join(root, name))) throw new Error("Private environment files are forbidden for local SDK verification");
}
if (lstatSync(fixtures).isSymbolicLink()) throw new Error("Fixture root must be an owned physical directory");
const fixtureFiles = readdirSync(fixtures);
if (fixtureFiles.length !== 1 || fixtureFiles[0] !== "default-result-stream.workflow.ts"
  || !lstatSync(path.join(fixtures, fixtureFiles[0])).isFile()
  || lstatSync(path.join(fixtures, fixtureFiles[0])).isSymbolicLink()) {
  throw new Error("Only the reviewed local SDK workflow fixture may be scanned");
}
// Native ESM bundles must resolve this checkout's own dependencies, not a borrowed graph.
const attemptRoot = path.join(root, ".vitest/workflow-local", attemptId);
if (existsSync(attemptRoot)) throw new Error("Local SDK attempt directory already exists; preserve evidence and do not reuse it");

export default defineConfig({
  root,
  envDir: false,
  cacheDir: path.join(attemptRoot, "vite-cache"),
  plugins: [workflow({ cwd: fixtures, rootDir: attemptRoot, dataDir: path.join(attemptRoot, "data"), outDir: path.join(attemptRoot, "bundles") })],
  resolve: { alias: { "@": path.join(root, "src") } },
  test: {
    name: "workflow-local-sdk",
    environment: "node",
    include: ["tests/workflow-local/default-result-stream-sdk.test.ts"],
    env: localEnvironment,
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    retry: 0,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
