CREATE TABLE IF NOT EXISTS "hub_rate_limit" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"lastRequest" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hub_rate_limit" ENABLE ROW LEVEL SECURITY;