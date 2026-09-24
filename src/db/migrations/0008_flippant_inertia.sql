CREATE TABLE "evaluation_case_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"evaluation_run_id" uuid NOT NULL,
	"evaluation_case_id" uuid NOT NULL,
	"run_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expectations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"passed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_results_run_case_unique" ON "evaluation_case_results" USING btree ("evaluation_run_id","evaluation_case_id");--> statement-breakpoint
CREATE INDEX "evaluation_results_run_idx" ON "evaluation_case_results" USING btree ("evaluation_run_id");--> statement-breakpoint
CREATE INDEX "evaluation_cases_workspace_agent_idx" ON "evaluation_cases" USING btree ("workspace_id","agent_id");--> statement-breakpoint
CREATE INDEX "evaluation_runs_workspace_agent_idx" ON "evaluation_runs" USING btree ("workspace_id","agent_id","created_at");