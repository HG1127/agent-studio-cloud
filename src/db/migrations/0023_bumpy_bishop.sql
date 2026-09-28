ALTER TABLE "schedules" ADD COLUMN "request_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "schedules_workspace_request_idx" ON "schedules" USING btree ("workspace_id","request_id");