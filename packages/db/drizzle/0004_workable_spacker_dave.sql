CREATE TABLE IF NOT EXISTS "conversation_watermarks" (
	"user_id" text NOT NULL,
	"project_scope" text NOT NULL,
	"conversation_id" text NOT NULL,
	"last_archived_tokens" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_watermarks_user_id_project_scope_pk" PRIMARY KEY("user_id","project_scope")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversation_watermarks" ADD CONSTRAINT "conversation_watermarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
