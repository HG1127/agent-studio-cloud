CREATE INDEX "agent_versions_workspace_status_idx" ON "agent_versions" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "agents_workspace_archived_updated_idx" ON "agents" USING btree ("workspace_id","archived_at","updated_at");--> statement-breakpoint
CREATE INDEX "workflow_definitions_agent_created_idx" ON "workflow_definitions" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "run_steps_run_id_created_idx" ON "run_steps" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_workspace_created_idx" ON "runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_workspace_status_created_idx" ON "runs" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "runs_workspace_agent_created_idx" ON "runs" USING btree ("workspace_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "approvals_workspace_status_created_idx" ON "approvals" USING btree ("workspace_id","status","created_at");