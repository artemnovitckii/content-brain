"use client";

import { useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { ResizableDrawer } from "./ResizableDrawer";

export function CreatorChatToggle({
  slug,
  displayName,
}: {
  slug: string;
  displayName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-zinc-950 shadow-[0_0_20px_-4px_rgba(16,185,129,0.5)] transition hover:bg-emerald-400 hover:shadow-[0_0_30px_-2px_rgba(16,185,129,0.8)]"
      >
        Chat
      </button>

      <ResizableDrawer
        open={open}
        onClose={() => setOpen(false)}
        storageKey={`chat-drawer-width:creator`}
        header={
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
            <div className="text-sm text-zinc-300">
              <span className="text-zinc-500">Chatting with </span>
              <strong className="text-zinc-100">{displayName}</strong>
              <span className="text-zinc-500">&apos;s brain</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-zinc-500 transition hover:text-zinc-200"
            >
              ✕
            </button>
          </div>
        }
      >
        <ChatPanel
          scope={{ type: "creator", slug }}
          title={`${displayName}'s patterns`}
          subtitle="Grounded in their Patterns, Playbook, and full transcripts"
          emptyHint={`Try: 'what's ${displayName}'s strongest hook?' or 'compare their top and bottom reels'`}
        />
      </ResizableDrawer>
    </>
  );
}
