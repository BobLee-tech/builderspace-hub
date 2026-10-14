CREATE TABLE IF NOT EXISTS "hub_github_account" (
	"userId" uuid PRIMARY KEY NOT NULL,
	"githubId" bigint NOT NULL,
	"login" varchar(39) NOT NULL,
	"avatarUrl" text,
	"accessToken" text NOT NULL,
	"accessTokenExpiresAt" timestamp,
	"refreshToken" text,
	"refreshTokenExpiresAt" timestamp,
	"connectedAt" timestamp DEFAULT now() NOT NULL,
	"lastSyncedAt" timestamp
);
--> statement-breakpoint
ALTER TABLE "hub_github_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_github_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"repoFullName" varchar(140) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"ref" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"occurredAt" timestamp NOT NULL,
	CONSTRAINT "hub_github_event_unique" UNIQUE("userId","repoFullName","kind","ref"),
	CONSTRAINT "hub_github_event_kind_check" CHECK ("hub_github_event"."kind" IN ('commit', 'pr_opened', 'pr_merged', 'issue_opened'))
);
--> statement-breakpoint
ALTER TABLE "hub_github_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_github_account" ADD CONSTRAINT "hub_github_account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_github_event" ADD CONSTRAINT "hub_github_event_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_github_event_user_time_idx" ON "hub_github_event" USING btree ("userId","occurredAt");