import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "../components/providers";

export const metadata: Metadata = {
  title: { default: "remember-api · 你的个人 AI", template: "%s · remember-api" },
  description:
    "把偏好、项目记忆与数据沉淀成属于你的个人 AI。接入所有支持 OpenAI 兼容接口的 AI 工具与设备，共享同一份记忆。",
  icons: { icon: "/brand/remember-logo.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
