CREATE TABLE IF NOT EXISTS "conversation_summaries" (
	"user_id" text NOT NULL,
	"profile_id" text NOT NULL,
	"prev_conversation_id" text DEFAULT '' NOT NULL,
	"prev_summary_text" text DEFAULT '' NOT NULL,
	"prev_summary_tokens" integer DEFAULT 0 NOT NULL,
	"active_conversation_id" text DEFAULT '' NOT NULL,
	"active_summary_text" text DEFAULT '' NOT NULL,
	"last_summarized_tokens" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_summaries_user_id_profile_id_pk" PRIMARY KEY("user_id","profile_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
