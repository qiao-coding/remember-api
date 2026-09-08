/**
 * fetch 请求头构造 —— 独立成无依赖的纯函数，便于单测。
 *
 * 规则：
 * - 仅当存在 body 时才声明 `Content-Type: application/json`。否则空 body +
 *   JSON content-type 会让 Fastify 直接回 400
 *   （Body cannot be empty when content-type is set to 'application/json'），
 *   因此无 body 的 GET/DELETE 一律不加该头。
 * - 调用方传入的 header 优先生效；`accessToken` 负责注入 Authorization。
 */

export function buildRequestHeaders(
  init?: Pick<RequestInit, "method" | "body" | "headers">,
  accessToken?: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of toHeaderEntries(init?.headers)) headers[k] = v;
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  // body 存在但调用方没显式指定 content-type 时，默认 JSON。
  if (init?.body != null && headers["Content-Type"] == null) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

function toHeaderEntries(h?: HeadersInit): Array<[string, string]> {
  if (!h) return [];
  if (typeof Headers !== "undefined" && h instanceof Headers) return [...h.entries()];
  if (Array.isArray(h)) return h.map(([k, v]) => [String(k), String(v)]);
  return Object.entries(h as Record<string, string>);
}
