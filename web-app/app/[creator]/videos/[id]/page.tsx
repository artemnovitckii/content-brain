import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getVideo, formatNumber } from "@/lib/content";
import { VideoChatToggle } from "../../../_components/VideoChatToggle";
import { Thumbnail } from "../../../_components/Thumbnail";

export default async function VideoPage({
  params,
}: {
  params: Promise<{ creator: string; id: string }>;
}) {
  const { creator, id } = await params;
  const slug = decodeURIComponent(creator);
  const video = await getVideo(slug, id);
  if (!video) notFound();

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <Link
        href={`/${encodeURIComponent(slug)}?tab=videos`}
        className="text-xs text-zinc-500 hover:text-zinc-300"
      >
        ← {slug} videos
      </Link>

      <header className="mt-6 mb-10 grid gap-8 sm:grid-cols-[260px_1fr]">
        <a
          href={video.url || "#"}
          target="_blank"
          rel="noreferrer"
          className="group relative block overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
        >
          <Thumbnail
            src={video.thumbnail}
            alt={video.title}
            shortcode={video.shortcode}
            aspect="9/16"
            className="w-full transition group-hover:scale-[1.02]"
          />
          {video.url && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-zinc-950 via-zinc-950/70 to-transparent p-3 text-[10px] uppercase tracking-wider text-zinc-300 opacity-0 transition group-hover:opacity-100">
              open on source ↗
            </div>
          )}
        </a>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-400/80">
              {slug} · {video.date || "no date"}
            </p>
            <VideoChatToggle
              slug={slug}
              shortcode={video.shortcode}
              filename={video.filename}
              title={video.title}
            />
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{video.title}</h1>

          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <Stat label="views" value={formatNumber(video.views)} />
            <Stat label="likes" value={formatNumber(video.likes)} />
            <Stat label="comments" value={formatNumber(video.comments)} />
          </div>
          {video.duration > 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              {Math.round(video.duration)}s
              {video.url && (
                <>
                  {" · "}
                  <a
                    href={video.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:text-emerald-300"
                  >
                    open source ↗
                  </a>
                </>
              )}
            </p>
          )}

          {video.hashtags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {video.hashtags.map((h) => (
                <span
                  key={h}
                  className="rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400"
                >
                  #{h}
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {video.caption && (
        <section className="mb-10">
          <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Caption</h2>
          <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 p-5 text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
            {video.caption}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-wider text-zinc-500">Transcript</h2>
        {video.transcript ? (
          <article className="prose prose-invert prose-zinc max-w-none text-zinc-200">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{video.transcript}</ReactMarkdown>
          </article>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center text-sm text-zinc-500">
            No transcript captured for this video.
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
      <div className="text-base font-semibold tabular-nums text-zinc-100">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
