import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** API Key 鉴权后的用户（/v1 网关）；keyProfileId 恒非空 = 该 key 绑定某个人 model(profile)，只能聊它 */
    user?: { id: string; apiKeyId: string; keyProfileId: string };
    /** Supabase JWT 验签后的用户（/api 后台） */
    admin?: { userId: string; email?: string };
  }
}
