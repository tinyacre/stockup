ALTER TABLE "promotion" ADD CONSTRAINT "promotion_household_id_unique" UNIQUE("household_id","id");--> statement-breakpoint
ALTER TABLE "price_record" ADD COLUMN "promotion_id" text;--> statement-breakpoint
ALTER TABLE "price_record" ADD CONSTRAINT "price_record_promotion_fk" FOREIGN KEY ("household_id","promotion_id") REFERENCES "public"."promotion"("household_id","id") ON DELETE no action ON UPDATE no action;
