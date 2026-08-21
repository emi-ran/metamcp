ALTER TABLE "google_connections" DROP CONSTRAINT IF EXISTS "google_connections_user_id_unique";
--> statement-breakpoint
ALTER TABLE "google_connections" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "google_connections" SET "is_default" = true WHERE "uuid" IN (
  SELECT DISTINCT ON ("user_id") "uuid"
  FROM "google_connections"
  WHERE "revoked_at" IS NULL
  ORDER BY "user_id", "updated_at" DESC, "created_at" DESC
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "google_connections_user_id_email_unique" ON "google_connections" USING btree ("user_id", "email");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "google_connections_one_default_per_user_idx" ON "google_connections" USING btree ("user_id") WHERE "is_default" = true;
--> statement-breakpoint
ALTER TABLE "google_oauth_states" ADD COLUMN IF NOT EXISTS "intent" text DEFAULT 'connect' NOT NULL;
--> statement-breakpoint
ALTER TABLE "google_oauth_states" ADD COLUMN IF NOT EXISTS "target_connection_id" uuid;
