ALTER TABLE "run_steps" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-4000-8000-000000000002' NOT NULL;--> statement-breakpoint
ALTER TABLE "trace_events" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-4000-8000-000000000002' NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-4000-8000-000000000002' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "created_by" uuid DEFAULT '00000000-0000-4000-8000-000000000002' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;