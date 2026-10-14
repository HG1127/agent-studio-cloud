ALTER TABLE "runs" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "collaboration_tracking_version" text;--> statement-breakpoint
CREATE INDEX "runs_workspace_parent_created_idx" ON "runs" USING btree ("workspace_id","parent_run_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_workspace_legacy_parent_idx" ON "runs" USING btree ("workspace_id",lower(substring("source_key" from '^(?:agent-call|handoff):([0-9a-fA-F-]{36}):'))) WHERE "runs"."parent_run_id" is null and "runs"."source_type" in ('agent_call', 'handoff');