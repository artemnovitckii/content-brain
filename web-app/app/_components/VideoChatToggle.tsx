"use client";

import { useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { ResizableDrawer } from "./ResizableDrawer";

export function VideoChatToggle({
  slug,
  shortcode,
  filename,
  title,
}: {
  slug: string;
  shortcode: string;
  filename: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-zinc-950 shadow-[0_0_20px_-4px_rgba(16,185,129,0.5)] transition hover:bg-emerald-400 hover:shadow-[0_0_30px_-2px_rgba(16,185,129,0.8)]"
      >
        Chat with this reel
      </button>

      <ResizableDrawer
        open={open}
        onClose={() => setOpen(false)}
        storageKey="chat-drawer-width:video"
        header={
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
            <div className="min-w-0 text-sm text-zinc-300">
              <span className="text-zinc-500">Chatting about </span>
              <strong className="block truncate text-zinc-100">{title}</strong>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="ml-3 shrink-0 text-zinc-500 transition hover:text-zinc-200"
            >
              ✕
            </button>
          </div>
        }
      >
        <ChatPanel
          scope={{ type: "video", slug, shortcode, filename }}
          title="This reel"
          subtitle="Grounded in the caption, metrics, and full transcript of this one reel"
          emptyHint="Try: 'what's the hook?', 'why did this get X views?', 'rewrite this in artem's voice'"
        />
      </ResizableDrawer>
    </>
  );
}
