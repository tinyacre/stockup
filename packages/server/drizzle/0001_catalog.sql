CREATE TABLE "category" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"category_group_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "category_household_id_unique" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "category_group" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "category_group_household_id_unique" UNIQUE("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"pricing_unit_dimension" text NOT NULL,
	"pricing_unit_name" text NOT NULL,
	"base_size" double precision NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_base_size_check" CHECK ("product"."base_size" > 0),
	CONSTRAINT "product_pricing_unit_dimension_check" CHECK ("product"."pricing_unit_dimension" in ('weight', 'volume', 'count'))
);
--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_category_group_fk" FOREIGN KEY ("household_id","category_group_id") REFERENCES "public"."category_group"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_group" ADD CONSTRAINT "category_group_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_fk" FOREIGN KEY ("household_id","category_id") REFERENCES "public"."category"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_household_name_uidx" ON "category" USING btree ("household_id","name");--> statement-breakpoint
CREATE INDEX "category_household_group_idx" ON "category" USING btree ("household_id","category_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_group_household_name_uidx" ON "category_group" USING btree ("household_id","name");--> statement-breakpoint
CREATE INDEX "product_household_category_idx" ON "product" USING btree ("household_id","category_id");