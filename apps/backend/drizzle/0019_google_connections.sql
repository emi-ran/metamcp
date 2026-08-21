CREATE TABLE "google_connections" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"google_user_id" text,
	"email" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"access_token_iv" text NOT NULL,
	"access_token_auth_tag" text NOT NULL,
	"encrypted_refresh_token" text,
	"refresh_token_iv" text,
	"refresh_token_auth_tag" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"access_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "google_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code_verifier" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_oauth_states" ADD CONSTRAINT "google_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_connections_user_id_idx" ON "google_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "google_oauth_states_user_id_idx" ON "google_oauth_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "google_oauth_states_expires_at_idx" ON "google_oauth_states" USING btree ("expires_at");
