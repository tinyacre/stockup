CREATE TABLE "recognition" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"requested_by" text,
	"status" text NOT NULL,
	"error" text,
	"screenshot_content_type" text NOT NULL,
	"screenshot_size" integer NOT NULL,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "recognition_household_id_unique" UNIQUE("household_id","id"),
	CONSTRAINT "recognition_status_check" CHECK ("recognition"."status" in ('pending', 'succeeded', 'failed')),
	CONSTRAINT "recognition_error_check" CHECK (("recognition"."status" = 'failed') = ("recognition"."error" is not null)),
	CONSTRAINT "recognition_screenshot_content_type_check" CHECK ("recognition"."screenshot_content_type" in ('image/png', 'image/jpeg', 'image/webp', 'image/gif'))
);
--> statement-breakpoint
CREATE TABLE "recognition_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"recognition_id" text NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"size_text" text,
	"size_amount" double precision,
	"size_unit_dimension" text,
	"size_unit_name" text,
	"quantity" integer,
	"list_price" integer,
	"discounts" jsonb NOT NULL,
	"product_id" text,
	CONSTRAINT "recognition_draft_size_check" CHECK (("recognition_draft"."size_amount" is null) = ("recognition_draft"."size_unit_dimension" is null) and ("recognition_draft"."size_amount" is null) = ("recognition_draft"."size_unit_name" is null))
);
--> statement-breakpoint
ALTER TABLE "recognition" ADD CONSTRAINT "recognition_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition" ADD CONSTRAINT "recognition_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_draft" ADD CONSTRAINT "recognition_draft_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_draft" ADD CONSTRAINT "recognition_draft_recognition_fk" FOREIGN KEY ("household_id","recognition_id") REFERENCES "public"."recognition"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_draft" ADD CONSTRAINT "recognition_draft_product_fk" FOREIGN KEY ("household_id","product_id") REFERENCES "public"."product"("household_id","id") ON DELETE SET NULL ("product_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_draft_recognition_position_uidx" ON "recognition_draft" USING btree ("recognition_id","position");--> statement-breakpoint
CREATE INDEX "recognition_draft_household_product_idx" ON "recognition_draft" USING btree ("household_id","product_id");