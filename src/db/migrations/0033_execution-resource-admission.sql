CREATE TABLE "execution_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"revision" integer NOT NULL,
	"limits" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "execution_policy_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_limits" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "execution_root_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "execution_resources" jsonb;--> statement-breakpoint
ALTER TABLE "execution_policy_changes" ADD CONSTRAINT "execution_policy_changes_policy_id_execution_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."execution_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_policies_workspace_unique" ON "execution_policies" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_policy_changes_workspace_request_unique" ON "execution_policy_changes" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "execution_policy_changes_workspace_revision_unique" ON "execution_policy_changes" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE INDEX "runs_workspace_execution_reservation_idx" ON "runs" USING btree ("workspace_id","execution_root_run_id","id") WHERE "runs"."status" not in ('completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "runs_workspace_execution_root_idx" ON "runs" USING btree ("workspace_id","execution_root_run_id","id");