/**
 * live-connection 的 auth 门控回归（node 环境 renderToStaticMarkup，不引 jsdom）。
 * 核心契约：未登录（AuthProvider 缺省/authed=false）时 LiveFields 根本不挂载，
 * 因此 useKeys/useProfiles 零调用 → 对 /api 零请求。此测试用 mock 的 spy 钉死这条安全边界。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthProvider } from "@/components/docs/auth-provider";
import { LiveConnection } from "@/components/docs/live-connection";
import { maskKey } from "@/lib/domain/docs";

// next/link 在无 Next router 的 SSR 下不可用，替换为纯 <a>，避免炸渲染。
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// 数据层整体 mock：只关心 hooks 是否被调用 + 各分支怎么渲染，不测真请求。
const { useKeys, useProfiles } = vi.hoisted(() => ({ useKeys: vi.fn(), useProfiles: vi.fn() }));
vi.mock("@/lib/queries", () => ({ useKeys, useProfiles }));

const refetch = () => vi.fn();
/** react-query 结果对象的最小形态（live-connection 只用到的字段）。 */
const qk = <T,>(over: Partial<{ data: T; isLoading: boolean; isError: boolean }>) => ({
  data: undefined,
  isLoading: false,
  isError: false,
  refetch,
  ...over,
});

const key = (over: Partial<{ disabled: boolean; prefix: string; last4: string }> = {}) => ({
  id: "key_1",
  name: "k",
  disabled: false,
  prefix: "rma_ab",
  last4: "9f2c",
  ...over,
});

beforeEach(() => {
  useKeys.mockReset();
  useProfiles.mockReset();
});

describe("useDocsAuth 门控（安全边界：未登录 → 零数据请求）", () => {
  it("不包裹 AuthProvider 时默认未登录：出登录提示，且不挂载 LiveFields（hooks 零调用）", () => {
    const html = renderToStaticMarkup(<LiveConnection />);
    expect(html).toContain("登录后这里会显示你实例的 Base URL / API Key / Model。");
    expect(html).toContain("登录控制台查看");
    expect(html).toContain('href="/login?next=/docs/quickstart"');
    // 未登录绝不能碰数据层 —— 这就是「零 /api 请求」的根。
    expect(useKeys).not.toHaveBeenCalled();
    expect(useProfiles).not.toHaveBeenCalled();
  });

  it("显式 authed=false 与默认一致；authed=true 才会触发数据 hooks", () => {
    const unauthHtml = renderToStaticMarkup(
      <AuthProvider authed={false}>
        <LiveConnection />
      </AuthProvider>,
    );
    expect(unauthHtml).toContain("登录控制台查看");
    expect(useKeys).not.toHaveBeenCalled();

    useProfiles.mockReturnValue(qk({ data: [{ name: "deepseek-pro" }] }));
    useKeys.mockReturnValue(qk({ data: [key()], isLoading: false }));
    renderToStaticMarkup(
      <AuthProvider authed={true}>
        <LiveConnection />
      </AuthProvider>,
    );
    expect(useProfiles).toHaveBeenCalledTimes(1);
    expect(useKeys).toHaveBeenCalledTimes(1);
  });
});

describe("LiveFields（authed=true）", () => {
  it("加载中（无 data）：Key 区出骨架占位，不出现掩码/启用态/创建按钮", () => {
    useProfiles.mockReturnValue(qk({ isLoading: true }));
    useKeys.mockReturnValue(qk({ isLoading: true }));
    const html = renderToStaticMarkup(
      <AuthProvider authed={true}>
        <LiveConnection />
      </AuthProvider>,
    );
    expect(html).toContain("你的连接信息");
    expect(html).toContain("…"); // Key 加载占位
    expect(html).not.toContain("…9f2c"); // 不泄掩码尾号
    expect(html).not.toContain("已启用");
    // 加载中无 data → 走「待配置」兜底，会同时给出去 /keys 的创建入口（产品现状），不钉它
  });

  it("有启用 key + profile：渲染掩码与模型名，动作是「管理」而非「创建」", () => {
    const k = key();
    useProfiles.mockReturnValue(qk({ data: [{ name: "deepseek-pro" }] }));
    useKeys.mockReturnValue(qk({ data: [k], isLoading: false }));
    const html = renderToStaticMarkup(
      <AuthProvider authed={true}>
        <LiveConnection />
      </AuthProvider>,
    );
    expect(html).toContain(maskKey(k)); // prefix…last4，非明文
    expect(html).toContain("deepseek-pro");
    expect(html).toContain("已启用");
    expect(html).toContain("管理 API Key");
    expect(html).not.toContain("创建 API Key");
  });

  it("只有禁用 key：仍出掩码，标「已禁用」并提示去管理", () => {
    const k = key({ disabled: true });
    useProfiles.mockReturnValue(qk({ data: [{ name: "deepseek-pro" }] }));
    useKeys.mockReturnValue(qk({ data: [k], isLoading: false }));
    const html = renderToStaticMarkup(
      <AuthProvider authed={true}>
        <LiveConnection />
      </AuthProvider>,
    );
    expect(html).toContain(maskKey(k));
    expect(html).toContain("已禁用");
  });

  it("无任何 key：提示待配置，动作是「创建 API Key」", () => {
    useProfiles.mockReturnValue(qk({ data: [{ name: "deepseek-pro" }] }));
    useKeys.mockReturnValue(qk({ data: [], isLoading: false }));
    const html = renderToStaticMarkup(
      <AuthProvider authed={true}>
        <LiveConnection />
      </AuthProvider>,
    );
    expect(html).toContain("待配置");
    expect(html).toContain("创建 API Key");
    expect(html).not.toContain("已启用");
  });

  it("数据拉取失败：出重试分支（可再次 refetch）", () => {
    useProfiles.mockReturnValue(qk({ isError: true }));
    useKeys.mockReturnValue(qk({ isError: true }));
    const html = renderToStaticMarkup(
      <AuthProvider authed={true}>
        <LiveConnection />
      </AuthProvider>,
    );
    expect(html).toContain("连接信息加载失败，请确认后端服务可用。");
    expect(html).toContain("重试");
  });
});
