CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" text DEFAULT 'parsing' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"parse_engine" text,
	"error" text,
	"blob_pathname" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"spec" jsonb NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_id" uuid,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"lease_until" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "trace_events_run_id_seq_idx";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "source_type" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "source_key" text;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_chunks_source_index_unique" ON "knowledge_chunks" USING btree ("source_id","chunk_index");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_workspace_sha_unique" ON "knowledge_sources" USING btree ("workspace_id","sha256");--> statement-breakpoint
CREATE INDEX "knowledge_sources_workspace_status_idx" ON "knowledge_sources" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "schedules_workspace_status_next_idx" ON "schedules" USING btree ("workspace_id","status","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_source_key_unique" ON "runs" USING btree ("source_key") WHERE source_key is not null;