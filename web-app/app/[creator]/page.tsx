import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  getCreator,
  getCreatorDoc,
  getVideoMetasForCreator,
  formatNumber,
  type VideoMeta,
} from "@/lib/content";
import { Thumbnail } from "../_components/Thumbnail";
import { Avatar } from "../_components/Avatar";
import { AnalyzeButton } from "../_components/AnalyzeButton";
import { CreatorChatToggle } from "../_components/CreatorChatToggle";
import { RefreshReelsButton } from "../_components/RefreshReelsButton";

type Tab = "playbook" | "patterns" | "voice" | "videos";
type SortKey = "views" | "date";

export default async function CreatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ creator: string }>;
  searchParams: Promise<{ tab?: string; sort?: string }>;
}) {
  const { creator: creatorSlug } = await params;
  const { tab: tabParam, sort: sortParam } = await searchParams;
  const slug = decodeURIComponent(creatorSlug);
  const [creator, videosRaw] = await Promise.all([
    getCreator(slug),
    getVideoMetasForCreator(slug),
  ]);
  if (!creator) notFound();

  const tab: Tab = (["playbook", "patterns", "voice", "videos"].includes(tabParam || "")
    ? tabParam
    : creator.isSelf && creator.hasVoice
    ? "voice"
    : creator.hasPlaybook
    ? "playbook"
    : creator.hasVoice
    ? "voice"
    : "videos") as Tab;

  const sort: SortKey = sortParam === "date" ? "date" : "views";
  const videos = [...videosRaw].sort((a, b) =>
    sort === "date"
      ? (b.date || "").localeCompare(a.date || "")
      : b.views - a.views
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
        ← all creators
      </Link>

      <header className="mt-6 mb-10 flex items-start gap-5">
        <div className="relative shrink-0">
          <div className="absolute -inset-2 rounded-full bg-emerald-500/30 blur-xl" />
          <Avatar
            slug={creator.slug}
            src={creator.avatar}
            size={88}
            className="relative ring-2 ring-emerald-500/40"
          />
        </div>
        <div className="flex-1 flex-wrap items-start">
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-400/80">
              {creator.source === "youtube" ? "YouTube" : creator.source === "instagram" ? "Instagram" : creator.source === "tiktok" ? "TikTok" : creator.source}
            </p>
            {creator.profileUrl && (
              <a
                href={creator.profileUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-zinc-500 transition hover:text-emerald-300"
              >
                view profile ↗
              </a>
            )}
            {creator.isSelf && (
              <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-zinc-950">
                You
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-semibold tracking-tight">
              {creator.displayName}
            </h1>
            <div className="flex items-center gap-2">
              <CreatorChatToggle slug={creator.slug} displayName={creator.displayName} />
              <AnalyzeButton
                slug={creator.slug}
                isSelf={creator.isSelf}
                hasAnalysis={
                  creator.isSelf ? creator.hasVoice : creator.hasPlaybook && creator.hasPatterns
                }
              />
              <RefreshReelsButton
                slug={creator.slug}
                platform={
                  creator.source === "instagram" ||
                  creator.source === "tiktok" ||
                  creator.source === "youtube"
                    ? creator.source
                    : null
                }
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm text-zinc-400">
            {creator.followers !== null && (
              <span><strong className="text-zinc-100">{formatNumber(creator.followers)}</strong> followers</span>
            )}
            <span><strong className="text-zinc-100">{creator.videoCount.toLocaleString()}</strong> videos</span>
            <span><strong className="text-zinc-100">{formatNumber(creator.totalViews)}</strong> total views</span>
            <span><strong className="text-zinc-100">{formatNumber(creator.avgViews)}</strong> avg views</span>
            <span><strong className="text-zinc-100">{formatNumber(creator.topVideoViews)}</strong> top video</span>
          </div>
          {creator.firstDate && creator.lastDate && (
            <p className="mt-2 text-[11px] text-zinc-600">
              activity span: {creator.firstDate} → {creator.lastDate}
            </p>
          )}
        </div>
      </header>

      <nav className="mb-8 flex gap-1 border-b border-zinc-800">
        <TabLink slug={slug} tab="playbook" current={tab} disabled={!creator.hasPlaybook} />
        <TabLink slug={slug} tab="patterns" current={tab} disabled={!creator.hasPatterns} />
        <TabLink slug={slug} tab="voice" current={tab} disabled={!creator.hasVoice} />
        <TabLink slug={slug} tab="videos" current={tab} count={videos.length} />
      </nav>

      {tab === "videos" ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              {videos.length.toLocaleString()} reels · sorted by {sort === "date" ? "most recent" : "most viewed"}
            </p>
            <div className="flex overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40 text-xs">
              <SortLink slug={slug} sort="views" current={sort}>Popularity</SortLink>
              <SortLink slug={slug} sort="date" current={sort}>Recency</SortLink>
            </div>
          </div>
          <VideoList slug={slug} videos={videos} />
        </>
      ) : (
        <DocView slug={slug} doc={tab} />
      )}
    </div>
  );
}

function SortLink({
  slug,
  sort,
  current,
  children,
}: {
  slug: string;
  sort: SortKey;
  current: SortKey;
  children: React.ReactNode;
}) {
  const active = sort === current;
  return (
    <Link
      href={`/${encodeURIComponent(slug)}?tab=videos&sort=${sort}`}
      className={`px-3 py-1.5 transition ${
        active
          ? "bg-emerald-500 text-zinc-950"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
    >
      {children}
    </Link>
  );
}

function TabLink({
  slug,
  tab,
  current,
  count,
  disabled,
}: {
  slug: string;
  tab: Tab;
  current: Tab;
  count?: number;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <span className="cursor-not-allowed px-4 py-3 text-sm capitalize text-zinc-700">
        {tab}
      </span>
    );
  }
  const active = current === tab;
  return (
    <Link
      href={`/${encodeURIComponent(slug)}?tab=${tab}`}
      className={`-mb-px border-b-2 px-4 py-3 text-sm capitalize transition ${
        active
          ? "border-emerald-400 text-zinc-50"
          : "border-transparent text-zinc-500 hover:text-zinc-200"
      }`}
    >
      {tab}
      {count !== undefined && (
        <span className="ml-2 text-xs text-zinc-500">{count}</span>
      )}
    </Link>
  );
}

async function DocView({ slug, doc }: { slug: string; doc: "playbook" | "patterns" | "voice" }) {
  const docName = (doc[0].toUpperCase() + doc.slice(1)) as "Playbook" | "Patterns" | "Voice";
  const content = await getCreatorDoc(slug, docName);

  if (!content) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-12 text-center text-zinc-500">
        No {doc} generated yet for this creator.
      </div>
    );
  }

  return (
    <article className="prose prose-invert prose-zinc max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-3xl prose-h2:mt-10 prose-h2:text-xl prose-h2:border-b prose-h2:border-zinc-800 prose-h2:pb-2 prose-h3:text-base prose-h3:text-emerald-300 prose-a:text-emerald-400 prose-code:rounded prose-code:bg-zinc-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-emerald-300 prose-code:before:content-[''] prose-code:after:content-[''] prose-blockquote:border-emerald-400/40 prose-blockquote:text-zinc-300 prose-strong:text-zinc-100 prose-li:text-zinc-300">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </article>
  );
}

function VideoList({
  slug,
  videos,
}: {
  slug: string;
  videos: VideoMeta[];
}) {
  if (videos.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-12 text-center text-zinc-500">
        No videos yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {videos.map((v) => (
        <Link
          key={v.filename}
          href={`/${encodeURIComponent(slug)}/videos/${encodeURIComponent(v.filename)}`}
          className="group relative overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-900/40 transition hover:border-zinc-700"
        >
          <div className="relative">
            <Thumbnail
              src={v.thumbnail}
              alt={v.title}
              shortcode={v.shortcode}
              aspect="9/16"
              className="w-full transition group-hover:scale-105"
            />
            {/* View count badge */}
            <div className="absolute right-2 top-2 rounded-full bg-zinc-950/80 px-2 py-0.5 text-[10px] font-medium tabular-nums text-zinc-100 backdrop-blur-sm">
              {formatNumber(v.views)}
            </div>
            {/* Gradient overlay for title legibility */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-3">
              <p className="line-clamp-3 text-xs font-medium leading-snug text-zinc-100 group-hover:text-white">
                {v.title}
              </p>
              {v.date && (
                <p className="mt-1 text-[10px] text-zinc-400">{v.date}</p>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
