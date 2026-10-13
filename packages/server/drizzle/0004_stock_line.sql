ALTER TABLE "product" ADD COLUMN "stock_line" integer;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_stock_line_check" CHECK ("product"."stock_line" > 0);