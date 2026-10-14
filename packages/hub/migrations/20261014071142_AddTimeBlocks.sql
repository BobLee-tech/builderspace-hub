CREATE TABLE IF NOT EXISTS "hub_time_block" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"userId" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"title" varchar(80),
	"startsAt" timestamp NOT NULL,
	"endsAt" timestamp NOT NULL,
	"cardId" bigint,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hub_time_block_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "hub_time_block_kind_check" CHECK ("hub_time_block"."kind" IN ('free', 'busy', 'meeting', 'task')),
	CONSTRAINT "hub_time_block_range_check" CHECK ("hub_time_block"."endsAt" > "hub_time_block"."startsAt"),
	CONSTRAINT "hub_time_block_card_check" CHECK (("hub_time_block"."kind" = 'task') = ("hub_time_block"."cardId" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "hub_time_block" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_time_block" ADD CONSTRAINT "hub_time_block_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hub_time_block" ADD CONSTRAINT "hub_time_block_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hub_time_block_user_starts_idx" ON "hub_time_block" USING btree ("userId","startsAt");