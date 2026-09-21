ALTER TABLE "runs" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "finished_at" timestamp with time zone;