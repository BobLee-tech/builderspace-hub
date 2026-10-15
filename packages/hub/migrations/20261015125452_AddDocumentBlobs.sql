CREATE TABLE IF NOT EXISTS "hub_document_blob" (
	"storageKey" varchar(200) PRIMARY KEY NOT NULL,
	"body" "bytea" NOT NULL,
	"contentType" varchar(120) NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hub_document_blob" ENABLE ROW LEVEL SECURITY;