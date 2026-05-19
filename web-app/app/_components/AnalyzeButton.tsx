"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "running" | "done" | "error";
type Mode = "patterns_playbook" | "voice";

// Best-effort extraction of human-readable progress from claude's
// stream-json events. We just want the latest "thing happening".
function lineFromChunk(chunk: any): string | null {
  if (!chunk || typeof chunk !== "object") return null;
  if (chunk.type === "system" && chunk.subtype === "init") {
    return `session ${(chunk.session_id || "").slice(0, 8)} starting…`;
  }
  if (chunk.type === "assistant" && chunk.message?.content) {
    for (const c of chunk.message.content) {
      if (c.type === "text" && c.text) return c.text.slice(0, 200).replace(/\s+/g, " ");
      if (c.type === "tool_use") {
        const target =
          c.input?.file_path || c.input?.path || c.input?.command || c.input?.pattern || "";
        return `${c.name}: ${String(target).slice(0, 120)}`;
      }
    }
  }
  if (chunk.type === "result") {
    return chunk.is_error ? `error: ${chunk.result || "unknown"}` : "✓ done";
  }
  return null;
}

export function AnalyzeButton({
  slug,
  isSelf,
  hasAnalysis,
}: {
  slug: string;
  isSelf: boolean;
  hasAnalysis: boolean;
}) {
  const mode: Mode = isSelf ? "voice" : "patterns_playbook";
  const label = isSelf
    ? hasAnalysis
      ? "Re-analyze voice"
      : "Analyze voice"
    : hasAnalysis
    ? "Re-analyze"
    : "Analyze";

  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [log]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function start() {
    setOpen(true);
    setStatus("running");
    setLog([`Analyzing ${slug}…`]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, mode }),
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
          const dataLines = block
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6));
          if (dataLines.length === 0) continue;
          try {
            const evt = JSON.parse(dataLines.join("\n"));
            if (evt.type === "chunk") {
              const line = lineFromChunk(evt.data);
              if (line) setLog((p) => [...p, line]);
            } else if (evt.type === "done") {
              finalStatus = evt.success ? "done" : "error";
            } else if (evt.type === "log") {
              setLog((p) => [...p, evt.line]);
            }
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
        }, 1200);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setLog((p) => [...p, `error: ${(e as Error).message}`]);
        setStatus("error");
      }
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setStatus("idle");
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={start}
        disabled={status === "running"}
        className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-emerald-300 transition hover:border-emerald-400/60 hover:bg-emerald-500/20 disabled:opacity-50"
      >
        {status === "running" ? "Analyzing…" : label}
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
                Analyzing {slug} ({mode === "voice" ? "Voice" : "Patterns + Playbook"})
              </div>
              <button
                onClick={cancel}
                className="text-zinc-500 transition hover:text-zinc-200"
              >
                ✕
              </button>
            </header>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words bg-zinc-950 px-5 py-4 font-mono text-[11px] leading-relaxed text-zinc-400">
              {log.join("\n")}
              <div ref={logEndRef} />
            </pre>
            {status === "done" && (
              <div className="border-t border-zinc-800 bg-zinc-900/60 px-5 py-3 text-center text-xs text-emerald-300">
                Done — refreshing page…
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
