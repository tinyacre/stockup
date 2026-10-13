CREATE TABLE "channel" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "channel_household_id_unique" UNIQUE("household_id","id")
);
--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_household_name_uidx" ON "channel" USING btree ("household_id","name");