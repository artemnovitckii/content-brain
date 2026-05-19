"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Scope =
  | { type: "creator"; slug: string }
  | { type: "vault" }
  | { type: "video"; slug: string; shortcode: string; filename: string };

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  text: string;
  tools: string[]; // human-readable tool-use lines for assistant turns
  streaming?: boolean;
};

type ChunkResult =
  | { kind: "delta"; text: string }
  | { kind: "complete"; text: string }
  | { kind: "tool"; tool: string }
  | null;

// Claude's stream-json emits BOTH small text deltas (for live streaming) AND
// a final complete assistant message (the canonical, fully-formatted version).
// We tag them so the UI can:
//   - append deltas as they stream (raw concat, no newlines between chunks)
//   - REPLACE accumulated text with the complete message at the end (cleans
//     up any partial-token artifacts and applies the final markdown formatting)
function extractTextDelta(chunk: any): ChunkResult {
  if (!chunk || typeof chunk !== "object") return null;

  // Final, complete assistant message — replaces what we've streamed.
  if (chunk.type === "assistant" && chunk.message?.content) {
    for (const c of chunk.message.content) {
      if (c.type === "text" && typeof c.text === "string") {
        return { kind: "complete", text: c.text };
      }
      if (c.type === "tool_use") {
        const target =
          c.input?.file_path ||
          c.input?.path ||
          c.input?.pattern ||
          c.input?.command ||
          "";
        return {
          kind: "tool",
          tool: `${c.name}${target ? `: ${String(target).slice(0, 120)}` : ""}`,
        };
      }
    }
  }

  // Partial deltas — appended as-is.
  if (chunk.type === "stream_event" && chunk.event?.delta) {
    const d = chunk.event.delta;
    if (d.type === "text_delta" && typeof d.text === "string") {
      return { kind: "delta", text: d.text };
    }
  }
  if (
    chunk.type === "content_block_delta" &&
    chunk.delta?.type === "text_delta"
  ) {
    return { kind: "delta", text: chunk.delta.text };
  }
  return null;
}

export function ChatPanel({
  scope,
  title,
  subtitle,
  emptyHint,
}: {
  scope: Scope;
  title: string;
  subtitle?: string;
  emptyHint?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Compute a per-character signal so streaming text updates trigger
  // re-scroll, not just message count changes.
  const streamSig = messages
    .map((m) => `${m.id}:${m.text.length}`)
    .join("|");

  useEffect(() => {
    // Wait a frame so React has committed the new text/layout before we
    // measure scrollHeight.
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }, [streamSig]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text, tools: [] };
    const asstId = crypto.randomUUID();
    const asstMsg: Message = {
      id: asstId,
      role: "assistant",
      text: "",
      tools: [],
      streaming: true,
    };
    setMessages((m) => [...m, userMsg, asstMsg]);
    setInput("");
    setSending(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    // Two-phase accumulator:
    //   1. While streaming: append text deltas as raw concat (no separators).
    //   2. When the final "complete" assistant message arrives: REPLACE the
    //      whole text with that canonical version. This cleans up any
    //      mid-token chunking artifacts and prevents double-rendering.
    let deltaText = "";
    let completed = false; // once true, ignore further deltas
    const seenComplete = new Set<string>(); // de-dupe if claude re-emits

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          sessionId: sessionId || undefined,
          scope,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

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
          let evt: any;
          try {
            evt = JSON.parse(dataLines.join("\n"));
          } catch {
            continue;
          }

          if (evt.type === "session" && evt.sessionId) {
            setSessionId(evt.sessionId);
          } else if (evt.type === "chunk") {
            const out = extractTextDelta(evt.data);
            if (!out) continue;

            if (out.kind === "delta" && !completed) {
              // Live streaming: raw concat — claude's deltas are already
              // word/token-aligned; adding any separator wrecks formatting.
              deltaText += out.text;
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === asstId ? { ...msg, text: deltaText } : msg
                )
              );
            } else if (out.kind === "complete") {
              // Canonical message — replace the streamed approximation.
              if (seenComplete.has(out.text)) continue; // de-dupe re-emits
              seenComplete.add(out.text);
              completed = true;
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === asstId ? { ...msg, text: out.text } : msg
                )
              );
            } else if (out.kind === "tool") {
              setMessages((m) =>
                m.map((msg) =>
                  msg.id === asstId
                    ? { ...msg, tools: [...msg.tools, out.tool] }
                    : msg
                )
              );
            }
          } else if (evt.type === "done") {
            // finalize
          } else if (evt.type === "log") {
            // stderr line; surface in tools area for debugging
            setMessages((m) =>
              m.map((msg) =>
                msg.id === asstId
                  ? { ...msg, tools: [...msg.tools, `log: ${evt.line}`] }
                  : msg
              )
            );
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === asstId
              ? { ...msg, text: `error: ${(e as Error).message}`, streaming: false }
              : msg
          )
        );
      }
    } finally {
      setMessages((m) =>
        m.map((msg) =>
          msg.id === asstId ? { ...msg, streaming: false } : msg
        )
      );
      setSending(false);
    }
  }

  function reset() {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(null);
    setSending(false);
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-zinc-500">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-zinc-500">
          {sessionId && <span>session {sessionId.slice(0, 8)}</span>}
          {messages.length > 0 && (
            <button
              onClick={reset}
              className="rounded border border-zinc-800 px-2 py-0.5 transition hover:border-zinc-700 hover:text-zinc-300"
            >
              New chat
            </button>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto px-5 py-5"
      >
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            {emptyHint || "Ask anything."}
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "text-right" : ""}
          >
            <div
              className={`inline-block max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed text-left ${
                m.role === "user"
                  ? "bg-emerald-500 text-zinc-950"
                  : "bg-zinc-900 text-zinc-200"
              }`}
            >
              {m.role === "assistant" ? (
                m.text ? (
                  <div className="prose prose-invert prose-sm prose-zinc max-w-none prose-p:my-2 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1.5 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-code:rounded prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:text-emerald-300 prose-code:before:content-[''] prose-code:after:content-[''] prose-pre:bg-zinc-950 prose-pre:border prose-pre:border-zinc-800 prose-a:text-emerald-300 prose-strong:text-zinc-100">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                  </div>
                ) : m.streaming ? (
                  <Thinking />
                ) : null
              ) : (
                m.text
              )}
            </div>
            {m.role === "assistant" && m.tools.length > 0 && (
              <div className="mt-1 space-y-0.5 text-left text-[10px] text-zinc-600">
                {m.tools.slice(-3).map((t, i) => (
                  <div key={i} className="font-mono">↳ {t}</div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} aria-hidden className="h-0" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2 border-t border-zinc-800 px-4 py-3"
      >
        <AutoTextarea
          value={input}
          onChange={setInput}
          onSubmit={send}
          disabled={sending}
          placeholder="Type a message… (Shift+Enter for new line)"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500"
        >
          {sending ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function AutoTextarea({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: reset height, then set to scrollHeight, capped at ~10 lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 240); // ~10 lines max
    el.style.height = `${next}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          if (value.trim()) onSubmit();
        }
        // Shift+Enter (or Ctrl/Meta/Alt+Enter) falls through to default newline.
      }}
      placeholder={placeholder}
      disabled={disabled}
      className="flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-100 outline-none transition focus:border-emerald-500/60 disabled:opacity-60"
      style={{ overflowY: "auto" }}
    />
  );
}

function Thinking() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1 w-1 animate-pulse rounded-full bg-zinc-500" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-zinc-500 [animation-delay:150ms]" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-zinc-500 [animation-delay:300ms]" />
    </span>
  );
}
