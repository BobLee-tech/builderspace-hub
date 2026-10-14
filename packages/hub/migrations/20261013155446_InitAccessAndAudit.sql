CREATE TABLE IF NOT EXISTS "hub_access_grant_project" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"grantId" bigint NOT NULL,
	"workspaceId" bigint NOT NULL,
	"role" varchar(16) NOT NULL,
	CONSTRAINT "hub_access_grant_project_role_check" CHECK ("hub_access_grant_project"."role" IN ('admin', 'member', 'guest'))
);
--> statement-breakpoint
ALTER TABLE "hub_access_grant_project" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_access_grant" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"email" varchar(255) NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"hubRole" varchar(16),
	"note" varchar(280),
	"source" varchar(16) NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"consumedAt" timestamp,
	"consumedBy" uuid,
	"revokedAt" timestamp,
	"revokedBy" uuid,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_access_grant_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "hub_access_grant_tokenHash_unique" UNIQUE("tokenHash"),
	CONSTRAINT "hub_access_grant_source_check" CHECK ("hub_access_grant"."source" IN ('direct', 'application', 'cli')),
	CONSTRAINT "hub_access_grant_hub_role_check" CHECK ("hub_access_grant"."hubRole" IS NULL OR "hub_access_grant"."hubRole" IN ('owner', 'admin', 'viewer')),
	CONSTRAINT "hub_access_grant_email_lowercase_check" CHECK ("hub_access_grant"."email" = lower("hub_access_grant"."email"))
);
--> statement-breakpoint
ALTER TABLE "hub_access_grant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"actorUserId" uuid,
	"actorEmail" varchar(255) NOT NULL,
	"action" varchar(64) NOT NULL,
	"entityType" varchar(32) NOT NULL,
	"entityId" varchar(64),
	"summary" text NOT NULL,
	"detail" jsonb,
	CONSTRAINT "hub_audit_log_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "hub_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_access_grant_project" ADD CONSTRAINT "hub_access_grant_project_grantId_hub_access_grant_id_fk" FOREIGN KEY ("grantId") REFERENCES "public"."hub_access_grant"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_access_grant_project" ADD CONSTRAINT "hub_access_grant_project_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_access_grant" ADD CONSTRAINT "hub_access_grant_consumedBy_user_id_fk" FOREIGN KEY ("consumedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_access_grant" ADD CONSTRAINT "hub_access_grant_revokedBy_user_id_fk" FOREIGN KEY ("revokedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_access_grant" ADD CONSTRAINT "hub_access_grant_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_audit_log" ADD CONSTRAINT "hub_audit_log_actorUserId_user_id_fk" FOREIGN KEY ("actorUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hub_access_grant_project_unique_idx" ON "hub_access_grant_project" USING btree ("grantId","workspaceId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_access_grant_email_idx" ON "hub_access_grant" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hub_access_grant_open_email_idx" ON "hub_access_grant" USING btree ("email") WHERE "hub_access_grant"."consumedAt" IS NULL AND "hub_access_grant"."revokedAt" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_audit_log_at_idx" ON "hub_audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_audit_log_entity_idx" ON "hub_audit_log" USING btree ("entityType","entityId");