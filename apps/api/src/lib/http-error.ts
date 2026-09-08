/** 带状态码的 Fastify 兼容错误 */
export function httpError(
  status: number,
  message: string,
): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: status });
}
