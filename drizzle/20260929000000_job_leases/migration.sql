CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE,
  "email_verified" boolean NOT NULL DEFAULT false, "image" text,
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "session" (
  "id" text PRIMARY KEY, "expires_at" timestamp NOT NULL, "token" text NOT NULL UNIQUE,
  "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL,
  "ip_address" text, "user_agent" text,
  "user_id" text NOT NULL CONSTRAINT "session_user_id_user_id_fkey" REFERENCES "user"("id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account" (
  "id" text PRIMARY KEY, "account_id" text NOT NULL, "provider_id" text NOT NULL,
  "user_id" text NOT NULL CONSTRAINT "account_user_id_user_id_fkey" REFERENCES "user"("id") ON DELETE CASCADE,
  "access_token" text, "refresh_token" text, "id_token" text,
  "access_token_expires_at" timestamp, "refresh_token_expires_at" timestamp,
  "scope" text, "password" text, "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification" (
  "id" text PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL,
  "expires_at" timestamp NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
ALTER TABLE "ffmpeg_jobs" ADD COLUMN "lease_token" uuid;--> statement-breakpoint
ALTER TABLE "ffmpeg_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ffmpeg_jobs_claim_idx" ON "ffmpeg_jobs" ("status", "lease_expires_at");
