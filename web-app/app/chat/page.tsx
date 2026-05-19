import Link from "next/link";
import { getCreators, formatNumber } from "@/lib/content";
import { ChatPanel } from "../_components/ChatPanel";

export default async function MegaBrainChat() {
  const creators = await getCreators();
  const totalVideos = creators.reduce((s, c) => s + c.videoCount, 0);
  const totalViews = creators.reduce((s, c) => s + c.totalViews, 0);
  const withAnalysis = creators.filter((c) => c.hasPlaybook || c.hasVoice);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
        ← all creators
      </Link>

      <header className="mt-6 mb-8">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-300 shadow-[0_0_20px_-4px_rgba(16,185,129,0.4)]">
          <span className="synaptic-pulse text-emerald-400">◆</span>
          Mega-brain · synapses online
          <span className="synaptic-pulse text-emerald-400">◆</span>
        </div>
        <h1 className="bg-gradient-to-br from-zinc-50 via-zinc-100 to-emerald-200/80 bg-clip-text text-4xl font-semibold tracking-tight text-transparent sm:text-5xl">
          One conversation.<br />Every creator.
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Best-of-the-best synthesis across every creator you've studied. Surfaces what's working, ranked by evidence. Wired to{" "}
          <strong className="text-emerald-300">{withAnalysis.length} brains</strong>,{" "}
          <strong className="text-zinc-200">{totalVideos.toLocaleString()} reels</strong>,{" "}
          <strong className="text-zinc-200">{formatNumber(totalViews)} views</strong>.
        </p>
      </header>

      <div className="h-[70vh]">
        <ChatPanel
          scope={{ type: "vault" }}
          title="Mega-brain"
          subtitle={`Synthesizes across ${withAnalysis.map((c) => c.slug).join(", ")}`}
          emptyHint="Try: 'what's the strongest hook formula across all creators?' · 'rank the top CTAs by view count' · 'what works in IG that doesn't on YouTube?' · 'give me 5 hook templates I could steal'"
        />
      </div>
    </div>
  );
}
