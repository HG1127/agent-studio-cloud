CREATE TABLE "run_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"target_id" text NOT NULL,
	"target_hash" text NOT NULL,
	"retention_ms" bigint NOT NULL,
	"status" text DEFAULT 'waiting_result' NOT NULL,
	"payload" jsonb,
	"receipt" jsonb,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"retry_deadline" timestamp with time zone,
	"lease_owner" uuid,
	"lease_expires_at" timestamp with time zone,
	"workflow_run_id" text,
	"delivered_at" timestamp with time zone,
	"resolutions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "run_deliveries_workspace_run_unique" ON "run_deliveries" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE INDEX "run_deliveries_workspace_status_due_idx" ON "run_deliveries" USING btree ("workspace_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "run_deliveries_workspace_lease_idx" ON "run_deliveries" USING btree ("workspace_id","lease_expires_at");