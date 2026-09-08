/**
 * 纯展示组件渲染冒烟（node 环境 renderToStaticMarkup，不引 jsdom/testing-library）。
 * 目的：组件不被改坏（props 分支都还能出 markup），不做交互行为断言。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatDateTime } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { StatCard } from "@/components/stat-card";
import { DateCell } from "@/components/date-cell";
import { PageHeader } from "@/components/page-header";
import { Spinner } from "@/components/spinner";
import { EmptyRow, LoadingRows } from "@/components/table-states";

const count = (html: string, tag: "tr" | "td") =>
  (html.match(new RegExp(`<${tag}(?=[\\s>])`, "g")) ?? []).length;

describe("EmptyState", () => {
  it("渲染 title；有 description 才渲染说明；action 节点透出", () => {
    const html = renderToStaticMarkup(
      <EmptyState title="尚无数据" description="创建一个" action={<span>去创建</span>} />,
    );
    expect(html).toContain("尚无数据");
    expect(html).toContain("创建一个");
    expect(html).toContain("去创建");
    expect(html).toContain("<svg");
  });

  it("无 description/action 时对应文案不出现（null 分支安全）", () => {
    const html = renderToStaticMarkup(<EmptyState title="空" />);
    expect(html).toContain("空");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });
});

describe("ErrorState", () => {
  it("渲染错误消息；有 onRetry 才出现重试按钮", () => {
    const withRetry = renderToStaticMarkup(<ErrorState message="加载失败" onRetry={() => {}} />);
    expect(withRetry).toContain("加载失败");
    expect(withRetry).toContain("重试");

    const bare = renderToStaticMarkup(<ErrorState />);
    expect(bare).toContain("请确认后端服务可用");
    expect(bare).not.toContain("重试");
  });
});

describe("StatCard", () => {
  it("加载态显示 —（而非假值 0）", () => {
    const html = renderToStaticMarkup(<StatCard label="请求数" value={0} loading />);
    expect(html).toContain("请求数");
    expect(html).toContain(">—<");
    expect(html).not.toContain(">0<");
  });

  it("正常态透出 value 与 sub；accent 加高亮类", () => {
    const html = renderToStaticMarkup(
      <StatCard label="花费" value="$1.2" sub="近 7 天" accent />,
    );
    expect(html).toContain("$1.2");
    expect(html).toContain("近 7 天");
    expect(html).toContain("border-primary/20");
  });
});

describe("DateCell", () => {
  it("空值 → 占位 —", () => {
    const html = renderToStaticMarkup(<DateCell value={null} />);
    expect(html).toContain("—");
  });

  it("有值 → time[dateTime] 且文案为本地完整时间", () => {
    const d = new Date(2026, 0, 2, 3, 4);
    const html = renderToStaticMarkup(<DateCell value={d.toISOString()} />);
    // React SSR 属性序列化为 dateTime（与 DOM 的 datetime 不同，别写错）
    expect(html).toContain(`dateTime="${d.toISOString()}"`);
    expect(html).toContain(formatDateTime(d.toISOString()));
  });
});

describe("PageHeader", () => {
  it("渲染 title/description；无 description/actions 不渲染", () => {
    const full = renderToStaticMarkup(
      <PageHeader title="Keys" description="管理密钥" actions={<button>新建</button>} />,
    );
    expect(full).toContain("Keys");
    expect(full).toContain("管理密钥");
    expect(full).toContain("新建");

    const bare = renderToStaticMarkup(<PageHeader title="Keys" />);
    expect(bare).toContain("Keys");
    expect(bare).not.toContain("<p");
  });
});

describe("Spinner", () => {
  it("渲染旋转图标", () => {
    const html = renderToStaticMarkup(<Spinner />);
    expect(html).toContain("animate-spin");
    expect(html).toContain("<svg");
  });
});

describe("table-states", () => {
  it("LoadingRows 输出 rows × cols 个骨架格", () => {
    const html = renderToStaticMarkup(<LoadingRows cols={3} rows={2} />);
    expect(count(html, "tr")).toBe(2);
    expect(count(html, "td")).toBe(6);
  });

  it("EmptyRow 渲染 colSpan 与子节点", () => {
    const html = renderToStaticMarkup(
      <EmptyRow colSpan={4}>
        <span>没有匹配结果</span>
      </EmptyRow>,
    );
    expect(html).toMatch(/colspan="4"/i);
    expect(html).toContain("没有匹配结果");
  });
});
