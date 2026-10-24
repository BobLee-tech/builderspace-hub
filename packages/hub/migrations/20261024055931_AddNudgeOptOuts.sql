CREATE TABLE IF NOT EXISTS "hub_nudge_opt_out" (
	"userId" uuid PRIMARY KEY NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hub_nudge_opt_out" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_nudge_opt_out" ADD CONSTRAINT "hub_nudge_opt_out_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
