"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BrainCircuit, Check, Database, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const clients = [
  { name: "Claude Code", src: "/brand/tools/claude-color.svg" },
  { name: "Codex", src: "/brand/tools/codex-color.svg" },
  { name: "Cursor", src: "/brand/tools/cursor.svg" },
  { name: "opencode", src: "/brand/tools/opencode.svg" },
];

const pillars = [
  {
    no: "01",
    title: "你在哪，AI 都在",
    text: "公司电脑、家里笔记本、手机、浏览器——任意地点、任意设备连上同一个 API，接进来的都是同一个你。",
  },
  {
    no: "02",
    title: "工具与模型，随你换",
    text: "写代码用 Claude、聊天用 DeepSeek、推理用 GPT。工具和模型随便换，你的 AI 身份与记忆不受影响。",
  },
  {
    no: "03",
    title: "数据主权",
    text: "记忆归你、随时可查可改可导出。你的 AI 不属于某个模型厂商，而属于你。",
  },
];

const setupSteps = [
  {
    no: "01",
    title: "创建一个你的个人 AI",
    text: "在控制台建好，它就是专属于你的那一个 AI，之后所有设备都认它。",
  },
  {
    no: "02",
    title: "复制一份连接信息",
    text: "只有三项，复制到任意支持 AI 的工具里即可，不用学任何新东西。",
  },
  {
    no: "03",
    title: "接进每台设备，随处用",
    text: "把连接信息填进你在用的每台设备与每个 AI 客户端——公司、家里、手机上，都是同一个你，随时继续。",
  },
];

export default function Home() {
  return (
    <main className="min-h-dvh overflow-hidden bg-[#080b10] text-white">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#080b10]/78 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2" aria-label="remember-api 首页">
            <Image
              src="/brand/remember-logo.png"
              alt=""
              width={32}
              height={32}
              priority
              className="size-8"
            />
            <span className="text-sm font-semibold">remember-api</span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex" aria-label="首页导航">
            <Button asChild variant="ghost" size="sm" className="text-white/70 hover:bg-white/10 hover:text-white">
              <Link href="/">主页</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-white/70 hover:bg-white/10 hover:text-white">
              <Link href="/docs">Docs</Link>
            </Button>
            <Button asChild size="sm" className="bg-white text-[#08100f] hover:bg-white/90">
              <Link href="/login">
                进入控制台
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </nav>
          <Button asChild size="sm" className="bg-white text-[#08100f] hover:bg-white/90 sm:hidden">
            <Link href="/login">控制台</Link>
          </Button>
        </div>
      </header>

      <section className="relative px-4 pt-28 sm:px-6 lg:px-8">
        <Image
          src="/memory-network-hero.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-60"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#080b10_0%,rgba(8,11,16,0.96)_34%,rgba(8,11,16,0.5)_72%,#080b10_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(25,184,168,0.2),transparent_30%),radial-gradient(circle_at_78%_20%,rgba(245,173,66,0.12),transparent_24%)]" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-10 pb-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(400px,0.82fr)]">
          <div className="max-w-3xl">
            <Badge className="border border-white/15 bg-white/10 text-cyan-100 hover:bg-white/10">
              Personal AI Gateway
            </Badge>
            <h1 className="mt-7 text-5xl font-semibold leading-[1.04] sm:text-6xl lg:text-7xl">
              你在哪，你的 AI 就在哪
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/72">
              remember-api 把你的身份、偏好、项目与记忆，做成一个独立存在的 Personal AI。无论在公司电脑、家里的笔记本还是手机上——连上同一个 API，接进来的都是同一个你。工具换、地点换、模型换，你的 AI 始终记得你。
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="bg-[#19b8a8] text-white hover:bg-[#139e91]">
                <Link href="/login">
                  创建你的个人 AI
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white">
                <a href="#setup">三步接入</a>
              </Button>
            </div>
          </div>

          <MemoryHub />
        </div>
      </section>

      <section id="why" className="border-y border-white/10 bg-[#0d1118] px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionIntro
            eyebrow="为什么不一样"
            title="你是一个独立的人，AI 也该独立存在"
            text="今天的 AI 把你锁在某个 App、某台设备、某个模型里。remember-api 把你的身份、记忆和偏好抽出来独立存在——你在任何地方打开任何设备，接到的都是同一个你。"
          />
          <div className="mt-10 grid gap-0 overflow-hidden rounded-lg border border-white/10 bg-[#080b10] lg:grid-cols-3 lg:divide-x lg:divide-white/8">
            {pillars.map((pillar) => (
              <div key={pillar.no} className="p-6 sm:p-8">
                <p className="font-mono text-sm text-cyan-200">{pillar.no}</p>
                <h3 className="mt-3 text-xl font-semibold">{pillar.title}</h3>
                <p className="mt-3 text-sm leading-6 text-white/62">{pillar.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="setup" className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1fr_0.72fr]">
          <div>
            <SectionIntro
              eyebrow="三步接入"
              title="三步，让所有设备接上你的 AI"
              text="创建你的个人 AI，复制连接信息，填进你在用的每一台设备。之后就只有一个入口——你的 AI。"
            />
            <div className="mt-10 overflow-hidden rounded-lg border border-white/10 bg-white/[0.045]">
              {setupSteps.map((step, index) => (
                <div
                  key={step.no}
                  className={`flex gap-5 p-5 sm:p-6 ${index < setupSteps.length - 1 ? "border-b border-white/10" : ""}`}
                >
                  <span className="font-mono text-sm text-cyan-200">{step.no}</span>
                  <div>
                    <h3 className="text-base font-semibold">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-white/62">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <ConnectCard />
        </div>
      </section>

      <section className="border-t border-white/10 bg-[#0d1118] px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl rounded-lg border border-white/10 bg-[#080b10] p-6 text-center sm:p-10">
          <h2 className="text-2xl font-semibold sm:text-3xl">你在哪，你的 AI 就在哪</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-white/60 sm:text-base">
            创建一个独立存在的个人 AI。不管在公司、在家、手机上，接进来都是同一个你——身份、记忆与上下文只属于你。
          </p>
          <Button asChild size="lg" className="mt-7 bg-[#19b8a8] text-white hover:bg-[#139e91]">
            <Link href="/login">
              创建你的个人 AI
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

function SectionIntro({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-medium text-cyan-200">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-white/62">{text}</p>
    </div>
  );
}

function MemoryHub() {
  const features = [
    { icon: BrainCircuit, text: "一个独立存在、属于你的个人 AI" },
    { icon: Database, text: "任何设备、任何地点，接入都是同一个你" },
    { icon: PencilLine, text: "你的数据，随时可查、可改、可导出" },
  ];
  return (
    <aside className="rounded-lg border border-white/12 bg-[#0b1018]/88 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.48)] backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <Image
          src="/brand/remember-logo.png"
          alt=""
          width={44}
          height={44}
          className="size-11 shrink-0"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold">你的个人 AI</p>
          <p className="text-xs text-white/50">一次接入 · 处处记得</p>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {features.map((feature) => (
          <div key={feature.text} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.045] px-3 py-2.5">
            <feature.icon className="size-4 shrink-0 text-[#19b8a8]" />
            <span className="text-sm leading-5 text-white/78">{feature.text}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-white/10 pt-5">
        <p className="text-xs text-white/45">接入这些工具与设备</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {clients.map((client) => (
            <span
              key={client.name}
              className="flex items-center justify-center rounded-lg bg-white p-2.5 shadow-[0_1px_6px_rgba(0,0,0,0.28)]"
              title={client.name}
            >
              <img src={client.src} alt={client.name} className="size-6 shrink-0" loading="lazy" />
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}

function ConnectCard() {
  return (
    <aside className="h-fit rounded-lg border border-white/10 bg-[#111722] p-5 sm:p-6">
      <p className="text-sm font-semibold">一个入口，模型随你换</p>
      <div className="mt-4 space-y-3">
        {[
          "写代码 → Claude",
          "日常聊天 → DeepSeek",
          "复杂推理 → GPT",
          "隐私任务 → 本地模型",
        ].map((item) => (
          <div key={item} className="flex gap-3 rounded-lg border border-white/10 bg-[#090d13] px-3 py-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-cyan-200" />
            <span className="text-sm leading-5 text-white/72">{item}</span>
          </div>
        ))}
      </div>
      <p className="mt-5 text-sm leading-6 text-white/55">
        不同任务交给不同模型，但运行的始终是同一个人 AI——它记得你，不用重新熟悉。
      </p>
    </aside>
  );
}
