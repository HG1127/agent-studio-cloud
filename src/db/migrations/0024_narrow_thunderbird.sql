CREATE TABLE "tool_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"source_run_id" uuid NOT NULL,
	"node_title" text NOT NULL,
	"tool_id" text NOT NULL,
	"action" text NOT NULL,
	"key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"receipt" jsonb,
	"error" text,
	"lease_owner" uuid,
	"lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tool_operations_workspace_key_unique" ON "tool_operations" USING btree ("workspace_id","key_hash");--> statement-breakpoint
CREATE INDEX "tool_operations_workspace_run_idx" ON "tool_operations" USING btree ("workspace_id","source_run_id");