CREATE TABLE "evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"sequence" integer GENERATED ALWAYS AS IDENTITY (sequence name "evidence_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"household_id" text NOT NULL,
	"price_record_id" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_content_type_check" CHECK ("evidence"."content_type" in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
	CONSTRAINT "evidence_size_check" CHECK ("evidence"."size" > 0)
);
--> statement-breakpoint
ALTER TABLE "price_record" ADD CONSTRAINT "price_record_household_id_unique" UNIQUE("household_id","id");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_price_record_fk" FOREIGN KEY ("household_id","price_record_id") REFERENCES "public"."price_record"("household_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_household_price_record_idx" ON "evidence" USING btree ("household_id","price_record_id");
