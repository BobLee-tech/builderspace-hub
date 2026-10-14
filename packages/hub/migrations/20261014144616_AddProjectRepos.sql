CREATE TABLE IF NOT EXISTS "hub_project_repo" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"workspaceId" bigint NOT NULL,
	"fullName" varchar(140) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"createdBy" uuid,
	CONSTRAINT "hub_project_repo_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "hub_project_repo_workspace_name_unique" UNIQUE("workspaceId","fullName")
);
--> statement-breakpoint
ALTER TABLE "hub_project_repo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_project_repo" ADD CONSTRAINT "hub_project_repo_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_project_repo" ADD CONSTRAINT "hub_project_repo_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
