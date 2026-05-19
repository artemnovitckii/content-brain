"use client";

import Link from "next/link";
import { useState } from "react";
import { AddCreatorModal } from "./AddCreatorModal";

export function HomeActions() {
  const [addOpen, setAddOpen] = useState(false);
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Link
        href="/chat"
        className="group inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 backdrop-blur-sm transition hover:border-emerald-400/60 hover:bg-emerald-500/20 hover:shadow-[0_0_25px_-4px_rgba(16,185,129,0.6)]"
      >
        <span className="synaptic-pulse text-emerald-400">◆</span>
        Mega-brain
      </Link>
      <button
        onClick={() => setAddOpen(true)}
        className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 shadow-[0_0_20px_-4px_rgba(16,185,129,0.5)] transition hover:bg-emerald-400 hover:shadow-[0_0_30px_-2px_rgba(16,185,129,0.8)]"
      >
        + Add creator
      </button>
      <AddCreatorModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
