import Link from "next/link";
import { getCreators, formatNumber } from "@/lib/content";
import { Avatar } from "./_components/Avatar";
import { Thumbnail } from "./_components/Thumbnail";
import { HomeActions } from "./_components/HomeActions";
import { ProfileLink } from "./_components/ProfileLink";

export default async function Home() {
  const creators = await getCreators();
  const totalVideos = creators.reduce((s, c) => s + c.videoCount, 0);
  const totalViews = creators.reduce((s, c) => s + c.totalViews, 0);

  return (
    <div className="mx-auto max-w-6xl px-6 py-16">
      <section className="mb-16">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-emerald-300 backdrop-blur-sm">
              <span className="sparkle">✦</span>
              <span>Content Brain</span>
              <span className="sparkle">✦</span>
            </div>
            <h1 className="bg-gradient-to-br from-zinc-50 via-zinc-100 to-emerald-200/80 bg-clip-text text-5xl font-semibold tracking-tight text-transparent sm:text-6xl">
              Every creator,<br />in one brain.
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-zinc-400">
              <strong className="text-zinc-200">{creators.length} brains</strong> ·{" "}
              <strong className="text-zinc-200">{totalVideos.toLocaleString()}</strong> reels ·{" "}
              <strong className="text-zinc-200">{formatNumber(totalViews)}</strong> views indexed. Transcripts, playbooks, and patterns — pick a brain or chat with all of them.
            </p>
          </div>
          <HomeActions />
        </div>
      </section>

      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {creators.map((c) => (
          <Link
            key={c.slug}
            href={`/${encodeURIComponent(c.slug)}`}
            className={`group relative overflow-hidden rounded-2xl border bg-zinc-900/40 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-zinc-900 ${
              c.isSelf
                ? "border-emerald-500/40 shadow-[0_0_0_1px_rgba(16,185,129,0.20),0_0_30px_-8px_rgba(16,185,129,0.45)] hover:border-emerald-400/60 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.40),0_0_45px_-6px_rgba(16,185,129,0.65)]"
                : "border-zinc-800/70 hover:border-emerald-400/30 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.15),0_0_30px_-10px_rgba(16,185,129,0.30)]"
            }`}
          >
            {/* Ambient glow that intensifies on hover */}
            <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-emerald-500/0 via-cyan-500/0 to-emerald-500/0 opacity-0 transition-opacity duration-500 group-hover:from-emerald-500/10 group-hover:via-cyan-500/5 group-hover:to-emerald-500/10 group-hover:opacity-100" />
            {c.isSelf && (
              <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-950 shadow-[0_0_12px_rgba(16,185,129,0.6)]">
                <span className="synaptic-pulse">●</span> You
              </span>
            )}
            {/* Top-video peek as ambient background */}
            <div className="relative h-32 overflow-hidden">
              <Thumbnail
                src={c.topVideoThumb}
                alt={`${c.displayName} top video`}
                shortcode={c.slug}
                aspect="auto"
                className="h-full w-full scale-110 blur-[2px] opacity-60 transition group-hover:scale-100 group-hover:opacity-90 group-hover:blur-0"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-zinc-900/30 to-zinc-900" />
            </div>

            <div className="relative px-5 pb-5">
              {/* Avatar overlapping the band, with synaptic glow ring */}
              <div className="-mt-8 mb-4 flex items-end justify-between">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-full bg-emerald-500/0 blur-md transition group-hover:bg-emerald-500/40" />
                  <Avatar
                    slug={c.slug}
                    src={c.avatar}
                    size={64}
                    className="relative ring-4 ring-zinc-950"
                  />
                </div>
                <span className="text-[10px] uppercase tracking-wider text-emerald-400 opacity-0 transition group-hover:opacity-100">
                  enter →
                </span>
              </div>

              <h2 className="text-lg font-semibold tracking-tight text-zinc-100 group-hover:text-white">
                {c.displayName}
              </h2>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                <span>
                  {c.source === "youtube" ? "YouTube" : c.source === "instagram" ? "Instagram" : c.source === "tiktok" ? "TikTok" : c.source === "mixed" ? "Multi-platform" : "—"}
                </span>
                {c.profileUrl && (
                  <ProfileLink
                    href={c.profileUrl}
                    className="opacity-0 transition group-hover:opacity-100 hover:text-emerald-300"
                  />
                )}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                {c.followers !== null ? (
                  <Stat label="followers" value={formatNumber(c.followers)} />
                ) : (
                  <Stat label="videos" value={c.videoCount.toLocaleString()} />
                )}
                <Stat label="total views" value={formatNumber(c.totalViews)} />
                <Stat label="avg views" value={formatNumber(c.avgViews)} />
              </div>
              {c.followers !== null && (
                <p className="mt-2 text-[10px] uppercase tracking-wider text-zinc-600">
                  {c.videoCount.toLocaleString()} reels analyzed
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-1.5">
                {c.hasVoice && <Tag>voice</Tag>}
                {c.hasPlaybook && <Tag>playbook</Tag>}
                {c.hasPatterns && <Tag>patterns</Tag>}
                {c.lastDate && <Tag muted>last: {c.lastDate}</Tag>}
              </div>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-medium text-zinc-100">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}

function Tag({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
        muted
          ? "border-zinc-800 text-zinc-500"
          : "border-emerald-400/30 bg-emerald-400/5 text-emerald-300"
      }`}
    >
      {children}
    </span>
  );
}
