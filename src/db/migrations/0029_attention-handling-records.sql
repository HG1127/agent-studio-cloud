CREATE TABLE "attention_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"occurrence" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "attention_cases_workspace_source_occurrence_unique" ON "attention_cases" USING btree ("workspace_id","kind","source_id","occurrence");--> statement-breakpoint
CREATE INDEX "attention_cases_workspace_created_id_idx" ON "attention_cases" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "attention_cases_workspace_run_idx" ON "attention_cases" USING btree ("workspace_id","run_id");