CREATE TABLE "run_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"rating" text NOT NULL,
	"note" text,
	"evaluation_case_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "run_feedback_workspace_run_unique" ON "run_feedback" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE INDEX "run_feedback_workspace_agent_updated_idx" ON "run_feedback" USING btree ("workspace_id","agent_id","updated_at");