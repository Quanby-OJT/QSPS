ALTER TABLE "documents" ADD COLUMN "print_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "card_offset_x_mm" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "card_offset_y_mm" real DEFAULT 0 NOT NULL;