CREATE TABLE IF NOT EXISTS "hub_form_image" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"formId" bigint NOT NULL,
	"responseId" bigint,
	"fieldId" varchar(16),
	"kind" varchar(16) NOT NULL,
	"uploadedBy" uuid,
	"contentType" varchar(32) NOT NULL,
	"size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"body" "bytea" NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_form_image_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "hub_form_image_kind_check" CHECK ("hub_form_image"."kind" IN ('asset', 'answer')),
	CONSTRAINT "hub_form_image_size_check" CHECK ("hub_form_image"."size" > 0)
);
--> statement-breakpoint
ALTER TABLE "hub_form_image" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_form_like" (
	"responseId" bigint NOT NULL,
	"voterKey" varchar(80) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_form_like_responseId_voterKey_pk" PRIMARY KEY("responseId","voterKey")
);
--> statement-breakpoint
ALTER TABLE "hub_form_like" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_form_manager" (
	"formId" bigint NOT NULL,
	"userId" uuid NOT NULL,
	"grantedBy" uuid,
	"grantedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_form_manager_formId_userId_pk" PRIMARY KEY("formId","userId")
);
--> statement-breakpoint
ALTER TABLE "hub_form_manager" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_form_response" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"formId" bigint NOT NULL,
	"userId" uuid,
	"respondentName" varchar(255),
	"answers" jsonb NOT NULL,
	"submissionKey" uuid NOT NULL,
	"editTokenHash" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_form_response_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "hub_form_response" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_form" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"title" varchar(120) NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"access" varchar(16) DEFAULT 'members' NOT NULL,
	"definition" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"closesAt" timestamp,
	"maxResponses" integer,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_form_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "hub_form_status_check" CHECK ("hub_form"."status" IN ('draft', 'open', 'closed')),
	CONSTRAINT "hub_form_access_check" CHECK ("hub_form"."access" IN ('public', 'members', 'projects')),
	CONSTRAINT "hub_form_max_responses_check" CHECK ("hub_form"."maxResponses" IS NULL OR "hub_form"."maxResponses" > 0)
);
--> statement-breakpoint
ALTER TABLE "hub_form" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_form_image" ADD CONSTRAINT "hub_form_image_formId_hub_form_id_fk" FOREIGN KEY ("formId") REFERENCES "public"."hub_form"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_form_image" ADD CONSTRAINT "hub_form_image_responseId_hub_form_response_id_fk" FOREIGN KEY ("responseId") REFERENCES "public"."hub_form_response"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_form_image" ADD CONSTRAINT "hub_form_image_uploadedBy_user_id_fk" FOREIGN KEY ("uploadedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_form_like" ADD CONSTRAINT "hub_form_like_responseId_hub_form_response_id_fk" FOREIGN KEY ("responseId") REFERENCES "public"."hub_form_response"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_form_manager" ADD CONSTRAINT "hub_form_manager_formId_hub_form_id_fk" FOREIGN KEY ("formId") REFERENCES "public"."hub_form"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_form_manager" ADD CONSTRAINT "hub_form_manager_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_form_manager" ADD CONSTRAINT "hub_form_manager_grantedBy_user_id_fk" FOREIGN KEY ("grantedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_form_response" ADD CONSTRAINT "hub_form_response_formId_hub_form_id_fk" FOREIGN KEY ("formId") REFERENCES "public"."hub_form"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_form_response" ADD CONSTRAINT "hub_form_response_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_form" ADD CONSTRAINT "hub_form_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_form_image_form_idx" ON "hub_form_image" USING btree ("formId","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_form_image_response_idx" ON "hub_form_image" USING btree ("responseId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_form_response_form_idx" ON "hub_form_response" USING btree ("formId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_form_response_user_idx" ON "hub_form_response" USING btree ("formId","userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hub_form_response_submission_idx" ON "hub_form_response" USING btree ("formId","submissionKey");