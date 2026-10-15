ALTER TABLE "videos" ADD COLUMN "stream_url" text;--> statement-breakpoint
-- Preserve existing transcoding rows and defaults without rebuilding the enum.
ALTER TYPE "video_status" RENAME VALUE 'transcoding' TO 'processing';
