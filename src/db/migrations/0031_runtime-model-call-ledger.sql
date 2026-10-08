CREATE TABLE "model_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"node_title" text NOT NULL,
	"model_id" text NOT NULL,
	"connection_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"measurement" jsonb,
	"failure" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "model_usage_tracking_version" text;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_calls_workspace_run_created_idx" ON "model_calls" USING btree ("workspace_id","run_id","created_at");--> statement-breakpoint
CREATE INDEX "model_calls_workspace_agent_created_idx" ON "model_calls" USING btree ("workspace_id","agent_id","created_at");