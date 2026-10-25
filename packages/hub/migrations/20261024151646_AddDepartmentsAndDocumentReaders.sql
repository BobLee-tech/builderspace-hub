CREATE TABLE IF NOT EXISTS "hub_department_member" (
	"departmentId" bigint NOT NULL,
	"workspaceId" bigint NOT NULL,
	"userId" uuid NOT NULL,
	"addedBy" uuid,
	"addedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_department_member_departmentId_workspaceId_userId_pk" PRIMARY KEY("departmentId","workspaceId","userId")
);
--> statement-breakpoint
ALTER TABLE "hub_department_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_department" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"name" varchar(40) NOT NULL,
	"position" integer NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_department_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "hub_department" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hub_document_reader" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"documentId" bigint NOT NULL,
	"userId" uuid,
	"workspaceId" bigint,
	"departmentId" bigint,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_document_reader_target_check" CHECK (("hub_document_reader"."userId" IS NULL) <> ("hub_document_reader"."workspaceId" IS NULL)
        AND ("hub_document_reader"."departmentId" IS NULL OR "hub_document_reader"."workspaceId" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "hub_document_reader" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_department_member" ADD CONSTRAINT "hub_department_member_departmentId_hub_department_id_fk" FOREIGN KEY ("departmentId") REFERENCES "public"."hub_department"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_department_member" ADD CONSTRAINT "hub_department_member_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_department_member" ADD CONSTRAINT "hub_department_member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_department_member" ADD CONSTRAINT "hub_department_member_addedBy_user_id_fk" FOREIGN KEY ("addedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_department" ADD CONSTRAINT "hub_department_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_reader" ADD CONSTRAINT "hub_document_reader_documentId_hub_document_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."hub_document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_reader" ADD CONSTRAINT "hub_document_reader_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_reader" ADD CONSTRAINT "hub_document_reader_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_document_reader" ADD CONSTRAINT "hub_document_reader_departmentId_hub_department_id_fk" FOREIGN KEY ("departmentId") REFERENCES "public"."hub_department"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_department_member_user_idx" ON "hub_department_member" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hub_department_name_idx" ON "hub_department" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_document_reader_document_idx" ON "hub_document_reader" USING btree ("documentId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hub_document_reader_user_idx" ON "hub_document_reader" USING btree ("documentId","userId") WHERE "hub_document_reader"."userId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hub_document_reader_group_idx" ON "hub_document_reader" USING btree ("documentId","workspaceId",coalesce("departmentId", 0)) WHERE "hub_document_reader"."workspaceId" IS NOT NULL;--> statement-breakpoint
-- The club's three departments to start with; more are added in the back office.
INSERT INTO "hub_department" ("publicId", "name", "position")
VALUES ('2iocl93zmjip', '技术', 1), ('eamrdef5yojd', '活动', 2), ('040izfzp4uhh', '运营', 3)
ON CONFLICT DO NOTHING;
