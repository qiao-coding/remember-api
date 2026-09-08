import type { FastifyInstance } from "fastify";
import { supabaseAuthHook } from "../../plugins/supabase-auth.js";
import { managerAuthRoutes } from "./auth.js";
import { managerKeysRoutes } from "./keys.js";
import { managerProfilesRoutes } from "./profiles.js";
import { managerProjectsRoutes } from "./projects.js";
import { managerMemoriesRoutes } from "./memories.js";
import { managerSkillsRoutes } from "./skills.js";
import { managerProvidersRoutes } from "./providers.js";
import { managerUsageRoutes } from "./usage.js";

/** 管理后台路由：全部需要 Supabase JWT */
export async function managerRoutes(app: FastifyInstance) {
  app.addHook("preHandler", (req, reply) => supabaseAuthHook(req, reply));

  app.register(managerAuthRoutes);
  app.register(managerKeysRoutes);
  app.register(managerProfilesRoutes);
  app.register(managerProjectsRoutes);
  app.register(managerMemoriesRoutes);
  app.register(managerSkillsRoutes);
  app.register(managerProvidersRoutes);
  app.register(managerUsageRoutes);
}
