"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "running" | "done" | "error";

export function AddCreatorModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState("");
  const [platform, setPlatform] = useState<"instagram" | "youtube" | "tiktok">("instagram");
  const [limit, setLimit] = useState(60);
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

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile.trim() || status === "running") return;

    setStatus("running");
    setLog([]);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: profile.trim(), platform, limit }),
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
            if (evt.type === "log") {
              setLog((prev) => [...prev, evt.line]);
            } else if (evt.type === "done") {
              finalStatus = evt.success ? "done" : "error";
            }
          } catch {
            /* ignore malformed events */
          }
        }
      }

      setStatus(finalStatus);
      if (finalStatus === "done") {
        // Give the new files a moment to be visible, then refresh.
        setTimeout(() => {
          router.refresh();
          handleClose();
        }, 800);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setLog((prev) => [...prev, `error: ${(e as Error).message}`]);
        setStatus("error");
      }
    }
  }

  function handleClose() {
    abortRef.current?.abort();
    setProfile("");
    setLog([]);
    setStatus("idle");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-6 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-100">
            Add a creator
          </h2>
          <button
            onClick={handleClose}
            disabled={status === "running"}
            className="text-zinc-500 transition hover:text-zinc-200 disabled:opacity-40"
          >
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs uppercase tracking-wider text-zinc-500">
              Username or profile URL
            </label>
            <input
              autoFocus
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              disabled={status === "running"}
              placeholder="e.g. mavgpt or https://www.instagram.com/mavgpt/"
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/60"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wider text-zinc-500">
                Platform
              </label>
              <select
                value={platform}
                onChange={(e) =>
                  setPlatform(e.target.value as "instagram" | "youtube" | "tiktok")
                }
                disabled={status === "running"}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/60"
              >
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="youtube">YouTube</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs uppercase tracking-wider text-zinc-500">
                Reel limit
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 60)}
                disabled={status === "running"}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-500/60"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={status === "running"}
              className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!profile.trim() || status === "running"}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {status === "running" ? "Scraping…" : "Start"}
            </button>
          </div>
        </form>

        {(status !== "idle" || log.length > 0) && (
          <div className="border-t border-zinc-800 bg-zinc-950/60 px-6 py-4">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
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
              {status === "running"
                ? "Running"
                : status === "done"
                ? "Done — refreshing"
                : status === "error"
                ? "Failed"
                : ""}
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-400">
              {log.join("\n")}
              <div ref={logEndRef} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
