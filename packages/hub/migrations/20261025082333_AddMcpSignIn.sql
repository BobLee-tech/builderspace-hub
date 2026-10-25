CREATE TABLE IF NOT EXISTS "hub_mcp_connection" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"clientId" bigint,
	"name" varchar(80),
	"userId" uuid NOT NULL,
	"accessTokenHash" varchar(64) NOT NULL,
	"accessExpiresAt" timestamp NOT NULL,
	"refreshTokenHash" varchar(64),
	"refreshExpiresAt" timestamp,
	"lastUsedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_mcp_connection_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "hub_mcp_connection_accessTokenHash_unique" UNIQUE("accessTokenHash"),
	CONSTRAINT "hub_mcp_connection_refreshTokenHash_unique" UNIQUE("refreshTokenHash"),
	CONSTRAINT "hub_mcp_connection_kind_check" CHECK (("hub_mcp_connection"."clientId" IS NOT NULL AND "hub_mcp_connection"."refreshTokenHash" IS NOT NULL AND "hub_mcp_connection"."refreshExpiresAt" IS NOT NULL) OR ("hub_mcp_connection"."clientId" IS NULL AND "hub_mcp_connection"."name" IS NOT NULL AND "hub_mcp_connection"."refreshTokenHash" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "hub_mcp_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_oauth_client" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"clientId" varchar(64) NOT NULL,
	"name" varchar(80) NOT NULL,
	"redirectUris" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_oauth_client_clientId_unique" UNIQUE("clientId")
);
--> statement-breakpoint
ALTER TABLE "hub_oauth_client" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_oauth_code" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"codeHash" varchar(64) NOT NULL,
	"clientId" bigint NOT NULL,
	"userId" uuid NOT NULL,
	"redirectUri" text NOT NULL,
	"codeChallenge" varchar(128) NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_oauth_code_codeHash_unique" UNIQUE("codeHash")
);
--> statement-breakpoint
ALTER TABLE "hub_oauth_code" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_mcp_connection" ADD CONSTRAINT "hub_mcp_connection_clientId_hub_oauth_client_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."hub_oauth_client"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_mcp_connection" ADD CONSTRAINT "hub_mcp_connection_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_oauth_code" ADD CONSTRAINT "hub_oauth_code_clientId_hub_oauth_client_id_fk" FOREIGN KEY ("clientId") REFERENCES "public"."hub_oauth_client"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_oauth_code" ADD CONSTRAINT "hub_oauth_code_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_mcp_connection_user_idx" ON "hub_mcp_connection" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_oauth_code_expires_idx" ON "hub_oauth_code" USING btree ("expiresAt");