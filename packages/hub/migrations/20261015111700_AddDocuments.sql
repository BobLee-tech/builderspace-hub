CREATE TABLE IF NOT EXISTS "hub_document_edit_request" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"documentId" bigint NOT NULL,
	"requesterId" uuid NOT NULL,
	"note" varchar(280),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"decidedBy" uuid,
	"decidedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_document_edit_request_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "hub_document_edit_request_status_check" CHECK ("hub_document_edit_request"."status" IN ('pending', 'approved', 'denied'))
);
--> statement-breakpoint
ALTER TABLE "hub_document_edit_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_document_editor" (
	"documentId" bigint NOT NULL,
	"userId" uuid NOT NULL,
	"grantedBy" uuid,
	"grantedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_document_editor_documentId_userId_pk" PRIMARY KEY("documentId","userId")
);
--> statement-breakpoint
ALTER TABLE "hub_document_editor" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_document_folder" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"name" varchar(80) NOT NULL,
	"parentId" bigint,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_document_folder_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "hub_document_folder" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_document_upload" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"userId" uuid NOT NULL,
	"documentId" bigint,
	"storageKey" varchar(200) NOT NULL,
	"filename" varchar(200) NOT NULL,
	"ext" varchar(8) NOT NULL,
	"contentType" varchar(120) NOT NULL,
	"size" bigint NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"consumedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_document_upload_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "hub_document_upload_storageKey_unique" UNIQUE("storageKey")
);
--> statement-breakpoint
ALTER TABLE "hub_document_upload" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_document" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"folderId" bigint,
	"title" varchar(120) NOT NULL,
	"description" varchar(500),
	"filename" varchar(200) NOT NULL,
	"ext" varchar(8) NOT NULL,
	"contentType" varchar(120) NOT NULL,
	"size" bigint NOT NULL,
	"sha256" varchar(64),
	"storageKey" varchar(200) NOT NULL,
	"readable" boolean DEFAULT true NOT NULL,
	"uploadedBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_document_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "hub_document_storageKey_unique" UNIQUE("storageKey"),
	CONSTRAINT "hub_document_size_check" CHECK ("hub_document"."size" > 0)
);
--> statement-breakpoint
ALTER TABLE "hub_document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_edit_request" ADD CONSTRAINT "hub_document_edit_request_documentId_hub_document_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."hub_document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_edit_request" ADD CONSTRAINT "hub_document_edit_request_requesterId_user_id_fk" FOREIGN KEY ("requesterId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_edit_request" ADD CONSTRAINT "hub_document_edit_request_decidedBy_user_id_fk" FOREIGN KEY ("decidedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_editor" ADD CONSTRAINT "hub_document_editor_documentId_hub_document_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."hub_document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_editor" ADD CONSTRAINT "hub_document_editor_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_editor" ADD CONSTRAINT "hub_document_editor_grantedBy_user_id_fk" FOREIGN KEY ("grantedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_folder" ADD CONSTRAINT "hub_document_folder_parentId_hub_document_folder_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."hub_document_folder"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_folder" ADD CONSTRAINT "hub_document_folder_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_upload" ADD CONSTRAINT "hub_document_upload_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_upload" ADD CONSTRAINT "hub_document_upload_documentId_hub_document_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."hub_document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document" ADD CONSTRAINT "hub_document_folderId_hub_document_folder_id_fk" FOREIGN KEY ("folderId") REFERENCES "public"."hub_document_folder"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document" ADD CONSTRAINT "hub_document_uploadedBy_user_id_fk" FOREIGN KEY ("uploadedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_document_edit_request_document_idx" ON "hub_document_edit_request" USING btree ("documentId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hub_document_edit_request_pending_idx" ON "hub_document_edit_request" USING btree ("documentId","requesterId") WHERE "hub_document_edit_request"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hub_document_folder_name_idx" ON "hub_document_folder" USING btree (coalesce("parentId", 0),lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_document_upload_user_idx" ON "hub_document_upload" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_document_folder_idx" ON "hub_document" USING btree ("folderId");