DROP INDEX "runs_source_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "runs_workspace_source_key_unique" ON "runs" USING btree ("workspace_id","source_key") WHERE source_key is not null;