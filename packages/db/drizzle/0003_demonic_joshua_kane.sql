-- 强制隔离改造：每个 key 必须绑定一个个人 model，每个 model 必须绑定一个项目。
-- 先清理存量未绑定的行，否则 SET NOT NULL 会失败。
DELETE FROM "api_keys" WHERE "profile_id" IS NULL;
--> statement-breakpoint
DELETE FROM "profiles" WHERE "project_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_project_id_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "profile_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "profiles" ALTER COLUMN "project_id" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profiles" ADD CONSTRAINT "profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
