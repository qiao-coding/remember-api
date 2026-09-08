-- RLS：纵深防御（defense-in-depth）。
-- Fastify 以 service_role/owner 连库会绕过 RLS，真正的隔离边界是 Fastify 的按用户过滤；
-- 这里开启 RLS 是为了拦截任何绕过应用的直连 DB 访问（如 PostgREST / SQL 客户端误操作）。
-- 表 user_id 为 text，auth.uid() 返回 uuid，故用 ::text 匹配。

ALTER TABLE public.users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skills         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_usage  ENABLE ROW LEVEL SECURITY;

-- users：每个人只能读写自己那一行
CREATE POLICY "users_self" ON public.users
  FOR ALL USING (id = auth.uid()::text) WITH CHECK (id = auth.uid()::text);

-- 租户表：user_id 必须等于当前登录用户
CREATE POLICY "tenant_own_api_keys" ON public.api_keys
  FOR ALL USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "tenant_own_projects" ON public.projects
  FOR ALL USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "tenant_own_profiles" ON public.profiles
  FOR ALL USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "tenant_own_skills" ON public.skills
  FOR ALL USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "tenant_own_provider_configs" ON public.provider_configs
  FOR ALL USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "tenant_own_memories" ON public.memories
  FOR ALL USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "tenant_own_request_usage" ON public.request_usage
  FOR ALL USING (user_id = auth.uid()::text) WITH CHECK (user_id = auth.uid()::text);
