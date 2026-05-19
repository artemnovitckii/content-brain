"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "running" | "done" | "error";

export function RefreshReelsButton({
  slug,
  platform,
}: {
  slug: string;
  platform: "instagram" | "tiktok" | "youtube" | null;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [log]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!platform) return null; // no platform → can't refresh

  async function start() {
    setOpen(true);
    setStatus("running");
    setLog([`Pulling latest reels for ${slug}…`]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: slug, platform, limit: 10 }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalStatus: Status = "error";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const lines = block
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6));
          if (lines.length === 0) continue;
          try {
            const evt = JSON.parse(lines.join("\n"));
            if (evt.type === "log") setLog((p) => [...p, evt.line]);
            else if (evt.type === "done") finalStatus = evt.success ? "done" : "error";
          } catch {
            /* ignore */
          }
        }
      }

      setStatus(finalStatus);
      if (finalStatus === "done") {
        setTimeout(() => {
          router.refresh();
          setOpen(false);
        }, 1000);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setLog((p) => [...p, `error: ${(e as Error).message}`]);
        setStatus("error");
      }
    }
  }

  return (
    <>
      <button
        onClick={start}
        disabled={status === "running"}
        className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-50"
      >
        {status === "running" ? "Pulling…" : "Pull latest"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/70 p-6 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
            <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
              <div className="flex items-center gap-2 text-sm text-zinc-200">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    status === "running"
                      ? "animate-pulse bg-emerald-400"
                      : status === "done"
                      ? "bg-emerald-500"
                      : status === "error"
                      ? "bg-rose-500"
                      : "bg-zinc-600"
                  }`}
                />
                Pulling latest reels for {slug}
              </div>
              <button
                onClick={() => {
                  abortRef.current?.abort();
                  setOpen(false);
                }}
                className="text-zinc-500 transition hover:text-zinc-200"
              >
                ✕
              </button>
            </header>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words bg-zinc-950 px-5 py-4 font-mono text-[11px] leading-relaxed text-zinc-400">
              {log.join("\n")}
              <div ref={logEndRef} />
            </pre>
          </div>
        </div>
      )}
    </>
  );
}
