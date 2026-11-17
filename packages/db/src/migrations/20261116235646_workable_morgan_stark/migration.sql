ALTER TABLE "locations" ADD COLUMN "id" serial;--> statement-breakpoint
ALTER TABLE "locations" DROP CONSTRAINT "locations_pkey";--> statement-breakpoint
ALTER TABLE "locations" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_code_key" UNIQUE("code");