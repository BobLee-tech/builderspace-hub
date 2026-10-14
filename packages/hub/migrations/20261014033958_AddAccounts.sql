CREATE TABLE IF NOT EXISTS "hub_account" (
	"userId" uuid PRIMARY KEY NOT NULL,
	"role" varchar(16),
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"suspendedAt" timestamp,
	"suspendedBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_account_role_check" CHECK ("hub_account"."role" IS NULL OR "hub_account"."role" IN ('owner', 'admin', 'viewer')),
	CONSTRAINT "hub_account_status_check" CHECK ("hub_account"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
ALTER TABLE "hub_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_account" ADD CONSTRAINT "hub_account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_account" ADD CONSTRAINT "hub_account_suspendedBy_user_id_fk" FOREIGN KEY ("suspendedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Carry over back-office roles from registration grants used before this table existed.
INSERT INTO "hub_account" ("userId", "role")
SELECT DISTINCT ON ("consumedBy") "consumedBy", "hubRole"
FROM "hub_access_grant"
WHERE "consumedBy" IS NOT NULL AND "hubRole" IS NOT NULL
ORDER BY "consumedBy", "consumedAt" DESC
ON CONFLICT ("userId") DO NOTHING;
