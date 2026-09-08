"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useProfiles, useProjects } from "@/lib/queries";
import type { MemoryItem } from "@/lib/types";
import { filterSearchHits } from "@/lib/domain/search";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

/** 顶栏全局搜索：Profiles / Projects / Memories 三组，Enter 跳转对应页（Ctrl/⌘ K 唤起）。 */
export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const profiles = useProfiles();
  const projects = useProjects();
  const memories = useQuery({
    queryKey: ["global-search", "memories", q.trim()],
    queryFn: () =>
      apiFetch<MemoryItem[]>(`/api/memories?q=${encodeURIComponent(q.trim())}&limit=5`),
    enabled: open && q.trim().length > 0,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { query, profileHits, projectHits, memoryHits } = filterSearchHits({
    q,
    profiles: profiles.data ?? [],
    projects: projects.data ?? [],
    memories: memories.data ?? [],
  });

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-9 w-9 px-0 md:w-72 md:justify-start md:px-3"
        onClick={() => setOpen(true)}
        aria-label="全局搜索（Ctrl/⌘ K）"
      >
        <Search className="h-4 w-4 shrink-0 md:mr-2" />
        <span className="hidden text-sm font-normal text-muted-foreground md:inline">
          搜索 Profile / Project / Memory…
        </span>
        <kbd className="pointer-events-none ml-auto hidden select-none rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground md:inline-flex">
          ⌘K
        </kbd>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:rounded-xl">
          <Command shouldFilter={false} className="rounded-lg">
            <CommandInput
              value={q}
              onValueChange={setQ}
              placeholder="搜索 Profiles / Projects / Memories…"
            />
            <CommandList>
              <CommandEmpty>
                {memories.isFetching ? "搜索中…" : "没有匹配结果"}
              </CommandEmpty>

              {profileHits.length > 0 ? (
                <CommandGroup heading={`Profiles · ${profileHits.length}`}>
                  {profileHits.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`profile-${p.id}`}
                      onSelect={() => go(`/profiles?focus=${p.id}`)}
                    >
                      <span className="font-mono text-xs">{p.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{p.model}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {projectHits.length > 0 ? (
                <CommandGroup heading={`Projects · ${projectHits.length}`}>
                  {projectHits.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`project-${p.id}`}
                      onSelect={() => go(`/projects?focus=${p.id}`)}
                    >
                      {p.name}
                      {p.status ? (
                        <span className="ml-2 text-xs text-muted-foreground">{p.status}</span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {query && (memoryHits.length > 0 || memories.isFetching) ? (
                <>
                  <CommandSeparator />
                  <CommandGroup heading={`Memories · ${memories.isFetching ? "…" : memoryHits.length}`}>
                    {memories.isFetching ? (
                      <CommandItem value="memories-loading" disabled>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 搜索记忆…
                      </CommandItem>
                    ) : (
                      memoryHits.map((m) => (
                        <CommandItem
                          key={m.id}
                          value={`memory-${m.id}`}
                          onSelect={() => go(`/memories?focus=${encodeURIComponent(m.id)}`)}
                        >
                          <span className="line-clamp-1">{m.content}</span>
                        </CommandItem>
                      ))
                    )}
                  </CommandGroup>
                </>
              ) : null}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
