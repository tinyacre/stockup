ALTER TABLE "recognition" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "recognition_draft" ADD COLUMN "order_discount" integer;--> statement-breakpoint
ALTER TABLE "recognition_draft" ADD CONSTRAINT "recognition_draft_order_discount_check" CHECK ("recognition_draft"."order_discount" >= 0);
