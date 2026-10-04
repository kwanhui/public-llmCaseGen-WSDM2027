CREATE TABLE IF NOT EXISTS "case_comparisons" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"plain_text" text NOT NULL,
	"structured_json" jsonb NOT NULL,
	"structured_provenance" jsonb NOT NULL,
	"model_id" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "case_comparisons_case_id_unique" UNIQUE("case_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "case_comparisons" ADD CONSTRAINT "case_comparisons_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comparisons_case_id_idx" ON "case_comparisons" USING btree ("case_id");