CREATE TABLE IF NOT EXISTS "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp_iso" text NOT NULL,
	"case_id" text NOT NULL,
	"variant_id" text,
	"event_type" text NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "case_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"learner_profile_json" jsonb NOT NULL,
	"content_json" jsonb NOT NULL,
	"invite_token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"first_viewed_at" timestamp,
	"last_viewed_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "case_variants_invite_token_unique" UNIQUE("invite_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"instructor_id" text NOT NULL,
	"discipline" text NOT NULL,
	"learning_objective" text NOT NULL,
	"difficulty" text NOT NULL,
	"must_cover_concepts" jsonb NOT NULL,
	"target_learner_profile" jsonb NOT NULL,
	"content_json" jsonb,
	"phases_json" jsonb NOT NULL,
	"current_phase_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"authoring_started_at" timestamp DEFAULT now() NOT NULL,
	"authoring_approved_at" timestamp,
	"authoring_seconds_logged" integer,
	"regeneration_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "student_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"phase_id" text NOT NULL,
	"activity_type" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp,
	"image" text,
	"role" text DEFAULT 'instructor' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_events" ADD CONSTRAINT "case_events_variant_id_case_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."case_variants"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_variants" ADD CONSTRAINT "case_variants_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cases" ADD CONSTRAINT "cases_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "student_responses" ADD CONSTRAINT "student_responses_variant_id_case_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."case_variants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_case_id_idx" ON "case_events" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_event_type_idx" ON "case_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_timestamp_idx" ON "case_events" USING btree ("timestamp_iso");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "variants_case_id_idx" ON "case_variants" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cases_instructor_id_idx" ON "cases" USING btree ("instructor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cases_discipline_idx" ON "cases" USING btree ("discipline");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cases_status_idx" ON "cases" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "responses_variant_id_idx" ON "student_responses" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "responses_variant_phase_idx" ON "student_responses" USING btree ("variant_id","phase_id");