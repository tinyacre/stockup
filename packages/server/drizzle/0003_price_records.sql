ALTER TABLE "product" ADD CONSTRAINT "product_household_id_unique" UNIQUE("household_id","id");--> statement-breakpoint
CREATE TABLE "discount" (
	"id" text PRIMARY KEY NOT NULL,
	"price_record_id" text NOT NULL,
	"position" integer NOT NULL,
	"amount" integer NOT NULL,
	"name" text,
	CONSTRAINT "discount_amount_check" CHECK ("discount"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_record" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"product_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"date" date NOT NULL,
	"purchased" boolean NOT NULL,
	"list_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"size_amount" double precision NOT NULL,
	"entered_size_amount" double precision NOT NULL,
	"entered_size_unit_name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by" text,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "price_record_list_price_check" CHECK ("price_record"."list_price" > 0),
	CONSTRAINT "price_record_quantity_check" CHECK ("price_record"."quantity" > 0),
	CONSTRAINT "price_record_size_check" CHECK ("price_record"."size_amount" > 0 and "price_record"."entered_size_amount" > 0),
	CONSTRAINT "price_record_source_check" CHECK ("price_record"."source" in ('manual', 'recognition', 'mcp'))
);
--> statement-breakpoint
ALTER TABLE "discount" ADD CONSTRAINT "discount_price_record_id_price_record_id_fk" FOREIGN KEY ("price_record_id") REFERENCES "public"."price_record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_record" ADD CONSTRAINT "price_record_household_id_organization_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_record" ADD CONSTRAINT "price_record_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_record" ADD CONSTRAINT "price_record_product_fk" FOREIGN KEY ("household_id","product_id") REFERENCES "public"."product"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_record" ADD CONSTRAINT "price_record_channel_fk" FOREIGN KEY ("household_id","channel_id") REFERENCES "public"."channel"("household_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_price_record_position_uidx" ON "discount" USING btree ("price_record_id","position");--> statement-breakpoint
CREATE INDEX "price_record_household_product_date_idx" ON "price_record" USING btree ("household_id","product_id","date");