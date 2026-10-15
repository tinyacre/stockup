ALTER TABLE "product" DROP CONSTRAINT "product_category_fk";--> statement-breakpoint
ALTER TABLE "product" ALTER COLUMN "category_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "category_group_id" text;--> statement-breakpoint
UPDATE "product" SET "category_group_id" = "category"."category_group_id" FROM "category" WHERE "category"."household_id" = "product"."household_id" AND "category"."id" = "product"."category_id";--> statement-breakpoint
ALTER TABLE "product" ALTER COLUMN "category_group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_household_id_group_unique" UNIQUE("household_id","id","category_group_id");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_group_fk" FOREIGN KEY ("household_id","category_group_id") REFERENCES "public"."category_group"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_fk" FOREIGN KEY ("household_id","category_id","category_group_id") REFERENCES "public"."category"("household_id","id","category_group_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "product_household_group_idx" ON "product" USING btree ("household_id","category_group_id");
