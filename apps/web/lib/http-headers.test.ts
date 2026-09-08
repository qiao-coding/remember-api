/**
 * 回归：DELETE/GET 无 body 时不得携带 `Content-Type: application/json`。
 *
 * 背景（2026-09）：apiFetch 曾对所有请求无条件加 JSON Content-Type，
 * 而 Fastify 对「空 body + application/json」直接回 400
 * （Body cannot be empty when content-type is set to 'application/json'），
 * 导致 /keys 等页面的删除请求全部 400。此处把请求头构造抽成纯函数后固化契约。
 */
import { describe, expect, it } from "vitest";
import { buildRequestHeaders } from "./http-headers";

describe("buildRequestHeaders", () => {
  it("DELETE 无 body → 不带 Content-Type（回归：曾导致 400）", () => {
    const headers = buildRequestHeaders({ method: "DELETE" });
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("GET 无 body → 不带 Content-Type", () => {
    const headers = buildRequestHeaders({ method: "GET" });
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("POST/PATCH 带 body → 自动加 application/json", () => {
    const post = buildRequestHeaders({ method: "POST", body: '{"a":1}' });
    expect(post["Content-Type"]).toBe("application/json");

    const patch = buildRequestHeaders({ method: "PATCH", body: '{"disabled":true}' });
    expect(patch["Content-Type"]).toBe("application/json");
  });

  it("body 为显式空字符串时同样视为有 body（跳过 Fastify 空 body 分支的边缘）", () => {
    const headers = buildRequestHeaders({ method: "POST", body: "" });
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("调用方显式指定 Content-Type 时不被覆盖", () => {
    const headers = buildRequestHeaders({
      method: "POST",
      body: "data",
      headers: { "Content-Type": "text/plain" },
    });
    expect(headers["Content-Type"]).toBe("text/plain");
  });

  it("有 accessToken 时注入 Authorization", () => {
    const headers = buildRequestHeaders({ method: "GET" }, "tok_123");
    expect(headers["Authorization"]).toBe("Bearer tok_123");
  });

  it("无 accessToken 时不带 Authorization", () => {
    const headers = buildRequestHeaders({ method: "GET" });
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("调用方自定义 header 保留（含无 body 请求）", () => {
    const headers = buildRequestHeaders({
      method: "DELETE",
      headers: { "X-Why": "custom" },
    });
    expect(headers["X-Why"]).toBe("custom");
  });

  it("body 与 accessToken 同时存在时两者都正确", () => {
    const headers = buildRequestHeaders(
      { method: "POST", body: '{"a":1}' },
      "tok",
    );
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe("Bearer tok");
  });
});
