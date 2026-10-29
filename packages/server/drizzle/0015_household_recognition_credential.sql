CREATE TABLE "household_recognition_credential" (
	"household_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"sealed_api_key" text NOT NULL,
	"api_key_last_four" text NOT NULL,
	"base_url" text,
	"model" text,
	"updated_at" timestamp NOT NULL,
	"updated_by" text,
	CONSTRAINT "household_recognition_credential_provider_check" CHECK ("household_recognition_credential"."provider" in ('anthropic', 'openai'))
);
--> statement-breakpoint
ALTER TABLE "recognition" ADD COLUMN "source" text;--> statement-breakpoint
-- Until households could bring their own key, every recognition that reached a recognizer used the instance's.
UPDATE "recognition" SET "source" = 'instance' WHERE "error" IS NULL OR "error" IN ('recognition_failed', 'recognition_interrupted');--> statement-breakpoint
ALTER TABLE "household_recognition_credential" ADD CONSTRAINT "household_recognition_credential_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_recognition_credential" ADD CONSTRAINT "household_recognition_credential_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition" ADD CONSTRAINT "recognition_source_check" CHECK ("recognition"."source" in ('household', 'instance'));