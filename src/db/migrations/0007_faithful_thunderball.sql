CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"source_run_id" uuid NOT NULL,
	"source_node_id" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memories_run_node_unique" ON "agent_memories" USING btree ("source_run_id","source_node_id");--> statement-breakpoint
CREATE INDEX "agent_memories_workspace_agent_idx" ON "agent_memories" USING btree ("workspace_id","agent_id","created_at");