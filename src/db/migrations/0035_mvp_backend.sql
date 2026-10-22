CREATE TABLE "default_result_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sdk_run_id" text NOT NULL,
	"frozen" jsonb NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"write_attempts" integer DEFAULT 0 NOT NULL,
	"operation" text,
	"operation_token" text,
	"waiting_hook_token" text,
	"waiting_hook_step_id" text,
	"acknowledgement" text DEFAULT 'none' NOT NULL,
	"producer_settled" boolean DEFAULT true NOT NULL,
	"error" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_agent_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"origin" text NOT NULL,
	"publication" jsonb NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "public_agent_tool_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"operation" text NOT NULL,
	"revision" integer NOT NULL,
	"key_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "public_agent_tool_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"tool_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "public_agent_tools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"publication" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "harness_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"revision" integer NOT NULL,
	"policy" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "harness_policy_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_policy" jsonb,
	"policy" jsonb,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "default_result_tracking_version" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "harness_policy_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "public_agent_tool_calls" ADD CONSTRAINT "public_agent_tool_calls_tool_id_public_agent_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."public_agent_tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_agent_tool_calls" ADD CONSTRAINT "public_agent_tool_calls_key_id_public_agent_tool_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."public_agent_tool_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_agent_tool_changes" ADD CONSTRAINT "public_agent_tool_changes_tool_id_public_agent_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."public_agent_tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_agent_tool_keys" ADD CONSTRAINT "public_agent_tool_keys_tool_id_public_agent_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."public_agent_tools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "harness_policy_changes" ADD CONSTRAINT "harness_policy_changes_policy_id_harness_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."harness_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "default_result_deliveries_workspace_run_unique" ON "default_result_deliveries" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE INDEX "default_result_deliveries_workspace_status_created_idx" ON "default_result_deliveries" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "public_agent_tool_calls_workspace_request_unique" ON "public_agent_tool_calls" USING btree ("workspace_id","tool_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_agent_tool_calls_run_unique" ON "public_agent_tool_calls" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_agent_tool_changes_workspace_request_unique" ON "public_agent_tool_changes" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "public_agent_tool_keys_hash_unique" ON "public_agent_tool_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "public_agent_tool_keys_workspace_tool_idx" ON "public_agent_tool_keys" USING btree ("workspace_id","tool_id");--> statement-breakpoint
CREATE INDEX "public_agent_tools_workspace_created_idx" ON "public_agent_tools" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_policies_workspace_unique" ON "harness_policies" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_policy_changes_workspace_request_unique" ON "harness_policy_changes" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "harness_policy_changes_workspace_revision_unique" ON "harness_policy_changes" USING btree ("workspace_id","revision");