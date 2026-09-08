/** httpError：Fastify 兼容「带状态码的错误」。 */
import { describe, expect, it } from "vitest";
import { httpError } from "./http-error";

describe("httpError", () => {
  it("attach statusCode 且为 Error 实例", () => {
    const e = httpError(404, "not found");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("not found");
    expect(e.statusCode).toBe(404);
  });

  it("statusCode 为 number 且可被 Fastify 读取", () => {
    const e = httpError(400, "bad");
    expect(typeof e.statusCode).toBe("number");
    expect(e.name).toBe("Error");
  });
});
