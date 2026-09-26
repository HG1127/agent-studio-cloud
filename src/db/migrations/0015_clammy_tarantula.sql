CREATE TABLE "wait_event_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"submission_token_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"hook_token" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"attempt_token" uuid NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wait_event_submissions_token_unique" ON "wait_event_submissions" USING btree ("workspace_id","submission_token_hash");--> statement-breakpoint
CREATE INDEX "wait_event_submissions_run_created_idx" ON "wait_event_submissions" USING btree ("workspace_id","run_id","created_at");