import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import matter from "gray-matter";

// Vault location resolution order:
//   1. CONTENT_BRAIN_ROOT env var (preferred name)
//   2. CONTENT_ROOT env var (legacy)
//   3. STUDY_OUTPUT_DIR env var (shared with the Python scripts)
//   4. <repo>/content-brain (default, assumes Next is run from web-app/)
const CONTENT_ROOT =
  process.env.CONTENT_BRAIN_ROOT ||
  process.env.CONTENT_ROOT ||
  process.env.STUDY_OUTPUT_DIR ||
  path.resolve(process.cwd(), "..", "content-brain");

const SKIP_FOLDERS = new Set([".obsidian", ".git", "topics", "node_modules"]);

// Per-creator skip list driven by env, so dev can run light.
// Example: SKIP_CREATORS=mrbeast,someother (case-insensitive)
const SKIP_CREATORS = new Set(
  (process.env.SKIP_CREATORS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function isSkipped(slug: string): boolean {
  return SKIP_CREATORS.has(slug.toLowerCase());
}

// gray-matter parses YAML dates (e.g. `date: 2025-11-17`) into JS Date objects,
// which serialize as ugly localized strings. Coerce to a clean YYYY-MM-DD.
function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

function buildProfileUrl(
  slug: string,
  source: string,
  sampleUrl: string | undefined
): string | null {
  if (source === "instagram") return `https://www.instagram.com/${slug}/`;
  if (source === "tiktok") return `https://www.tiktok.com/@${slug}/`;
  if (source === "youtube") {
    // We don't store the channel URL — but we can fall back to a video URL,
    // since clicking through opens the creator on YouTube via the right rail.
    return sampleUrl || `https://www.youtube.com/@${slug}`;
  }
  return null;
}

// Disk-side cache lives inside .next so it's gitignored and survives restarts
// but gets wiped on `next clean`.
const DISK_CACHE_DIR = path.join(process.cwd(), ".next", "cache", "content-brain");
// Cache filename varies by the skip list so dev and prod keep separate indexes.
const SKIP_KEY = Array.from(
  new Set(
    (process.env.SKIP_CREATORS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )
)
  .sort()
  .join("+") || "all";
const DISK_CACHE_FILE = path.join(
  DISK_CACHE_DIR,
  `creators-index.${SKIP_KEY}.json`
);

// Read concurrency. Higher saturates the kernel; lower keeps memory flat.
const READ_CONCURRENCY = 32;

export type CreatorSummary = {
  slug: string;
  displayName: string;
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  avgViews: number;
  topVideoViews: number;
  firstDate: string | null;
  lastDate: string | null;
  hasPlaybook: boolean;
  hasPatterns: boolean;
  hasVoice: boolean;
  isSelf: boolean;
  source: "youtube" | "instagram" | "tiktok" | "mixed" | "unknown";
  avatar: string;
  topVideoThumb: string | null;
  profileUrl: string | null;
  followers: number | null;
  followersUpdatedAt: string | null;
};

export type VideoMeta = {
  shortcode: string;
  filename: string;
  title: string;
  date: string | null;
  views: number;
  likes: number;
  comments: number;
  duration: number;
  url: string;
  thumbnail: string | null;
  hashtags: string[];
  source: string;
};

export type VideoFull = VideoMeta & {
  caption: string;
  transcript: string;
};

// Module-level memoization (single process). Mtime-keyed so edits invalidate.
const metaCache = new Map<string, { mtime: number; value: VideoMeta }>();
const fullCache = new Map<string, { mtime: number; value: VideoFull }>();
const creatorMetasCache = new Map<
  string,
  { mtime: number; value: VideoMeta[] }
>();
let creatorsCacheRef: { mtime: number; value: CreatorSummary[] } | null = null;

// Single-flight: dedupe concurrent calls during a cold start.
let creatorsInFlight: Promise<CreatorSummary[]> | null = null;
const creatorMetasInFlight = new Map<string, Promise<VideoMeta[]>>();

async function safeStat(p: string): Promise<fs.Stats | null> {
  try {
    return await fsp.stat(p);
  } catch {
    return null;
  }
}

function safeStatSync(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

async function listCreatorSlugs(): Promise<string[]> {
  const entries = await fsp.readdir(CONTENT_ROOT, { withFileTypes: true });
  return entries
    .filter(
      (e) =>
        e.isDirectory() &&
        !SKIP_FOLDERS.has(e.name) &&
        !isSkipped(e.name) &&
        !e.name.startsWith(".")
    )
    .map((e) => e.name)
    .sort();
}

function buildTitle(
  data: Record<string, unknown>,
  filepath: string,
  firstHeading: string | null
): string {
  if (typeof data.title === "string" && data.title) return data.title;
  if (firstHeading) return firstHeading;
  return path.basename(filepath, ".md");
}

function metaFromFrontmatter(
  data: Record<string, unknown>,
  filepath: string,
  firstHeading: string | null
): VideoMeta {
  const url = typeof data.url === "string" ? data.url : "";
  const inferredSource = url.includes("instagram")
    ? "instagram"
    : url.includes("tiktok")
    ? "tiktok"
    : url.includes("youtube")
    ? "youtube"
    : "unknown";
  const shortcode =
    (typeof data.shortcode === "string" && data.shortcode) ||
    path.basename(filepath, ".md");
  // Creator slug is the parent directory of the videos folder.
  const creatorSlug = path.basename(path.dirname(path.dirname(filepath)));
  return {
    shortcode,
    filename: path.basename(filepath, ".md"),
    title: buildTitle(data, filepath, firstHeading),
    date: data.date ? normalizeDate(data.date) : null,
    views: Number(data.views) || 0,
    likes: Number(data.likes) || 0,
    comments: Number(data.comments) || 0,
    duration: Number(data.duration_seconds) || 0,
    url,
    thumbnail:
      typeof data.thumbnail === "string"
        ? data.thumbnail
        : `/thumbs/${creatorSlug}/${shortcode}.jpg`,
    hashtags: Array.isArray(data.hashtags) ? (data.hashtags as string[]) : [],
    source:
      (typeof data.source === "string" && data.source) || inferredSource,
  };
}

// Read only enough of the file to capture frontmatter + first heading.
async function readFrontmatterOnly(filepath: string): Promise<{
  data: Record<string, unknown>;
  firstHeading: string | null;
} | null> {
  let handle: fsp.FileHandle | null = null;
  try {
    handle = await fsp.open(filepath, "r");
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const head = buf.slice(0, bytesRead).toString("utf8");

    if (!head.startsWith("---")) {
      return { data: {}, firstHeading: null };
    }
    const end = head.indexOf("\n---", 3);
    if (end === -1) {
      // Frontmatter larger than buffer — fall back to full read.
      await handle.close();
      handle = null;
      const raw = await fsp.readFile(filepath, "utf8");
      const parsed = matter(raw);
      const h = parsed.content.match(/^#\s+(.+)$/m);
      return {
        data: parsed.data as Record<string, unknown>,
        firstHeading: h?.[1]?.trim() || null,
      };
    }
    const fmBlock = head.slice(0, end + 4);
    const afterFm = head.slice(end + 4);
    const parsed = matter(fmBlock);
    const h = afterFm.match(/^#\s+(.+)$/m);
    return {
      data: parsed.data as Record<string, unknown>,
      firstHeading: h?.[1]?.trim() || null,
    };
  } catch {
    return null;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* ignore */
      }
    }
  }
}

async function getVideoMeta(filepath: string): Promise<VideoMeta | null> {
  const stat = await safeStat(filepath);
  if (!stat) return null;
  const cached = metaCache.get(filepath);
  if (cached && cached.mtime === stat.mtimeMs) return cached.value;

  const fm = await readFrontmatterOnly(filepath);
  if (!fm) return null;
  const value = metaFromFrontmatter(fm.data, filepath, fm.firstHeading);
  metaCache.set(filepath, { mtime: stat.mtimeMs, value });
  return value;
}

async function getVideoFull(filepath: string): Promise<VideoFull | null> {
  const stat = await safeStat(filepath);
  if (!stat) return null;
  const cached = fullCache.get(filepath);
  if (cached && cached.mtime === stat.mtimeMs) return cached.value;

  let raw: string;
  try {
    raw = await fsp.readFile(filepath, "utf8");
  } catch {
    return null;
  }
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const content = parsed.content;
  const captionMatch = content.match(/## Caption\s*\n([\s\S]*?)(?=\n## |\n# |$)/);
  const transcriptMatch = content.match(
    /## Transcript\s*\n([\s\S]*?)(?=\n## |\n# |$)/
  );
  const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || null;
  const meta = metaFromFrontmatter(data, filepath, firstHeading);
  const value: VideoFull = {
    ...meta,
    caption: captionMatch?.[1]?.trim() || "",
    transcript: transcriptMatch?.[1]?.trim() || "",
  };
  fullCache.set(filepath, { mtime: stat.mtimeMs, value });
  metaCache.set(filepath, { mtime: stat.mtimeMs, value: meta });
  return value;
}

// Bounded-concurrency parallel map. Avoids spawning 1000+ fds at once.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------- Disk cache ----------

type DiskIndex = {
  version: 1;
  rootMtime: number;
  creators: CreatorSummary[];
};

async function readDiskIndex(): Promise<DiskIndex | null> {
  try {
    const raw = await fsp.readFile(DISK_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as DiskIndex;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeDiskIndex(index: DiskIndex): Promise<void> {
  try {
    await fsp.mkdir(DISK_CACHE_DIR, { recursive: true });
    await fsp.writeFile(DISK_CACHE_FILE, JSON.stringify(index), "utf8");
  } catch {
    // Cache writes are best-effort.
  }
}

// Walk every video directory and find the latest mtime so we know if any
// file has changed since we last built the index.
async function computeContentMtime(): Promise<number> {
  const rootStat = await safeStat(CONTENT_ROOT);
  if (!rootStat) return 0;
  let latest = rootStat.mtimeMs;

  const slugs = await listCreatorSlugs();
  await Promise.all(
    slugs.map(async (slug) => {
      const videosDir = path.join(CONTENT_ROOT, slug, "videos");
      const s = await safeStat(videosDir);
      if (s && s.mtimeMs > latest) latest = s.mtimeMs;
    })
  );
  return latest;
}

// ---------- Public API ----------

export async function getCreators(): Promise<CreatorSummary[]> {
  // Cheap in-process memo: bail if the root dir hasn't changed since we built.
  const rootStat = await safeStat(CONTENT_ROOT);
  if (!rootStat) return [];

  if (creatorsCacheRef && creatorsCacheRef.mtime === rootStat.mtimeMs) {
    return creatorsCacheRef.value;
  }
  if (creatorsInFlight) return creatorsInFlight;

  creatorsInFlight = (async () => {
    const contentMtime = await computeContentMtime();

    // Try disk index first.
    const disk = await readDiskIndex();
    if (disk && disk.rootMtime === contentMtime) {
      creatorsCacheRef = { mtime: rootStat.mtimeMs, value: disk.creators };
      return disk.creators;
    }

    const slugs = await listCreatorSlugs();
    const summaries = (
      await Promise.all(slugs.map(async (slug) => buildCreatorSummary(slug)))
    )
      .filter((c): c is CreatorSummary => c !== null)
      .sort((a, b) => b.videoCount - a.videoCount);

    creatorsCacheRef = { mtime: rootStat.mtimeMs, value: summaries };
    await writeDiskIndex({
      version: 1,
      rootMtime: contentMtime,
      creators: summaries,
    });
    return summaries;
  })();

  try {
    return await creatorsInFlight;
  } finally {
    creatorsInFlight = null;
  }
}

async function readProfile(
  slug: string,
  fallbackVideoFile: string | null
): Promise<{ followers: number | null; updatedAt: string | null }> {
  const path1 = path.join(CONTENT_ROOT, slug, "profile.json");
  try {
    const raw = await fsp.readFile(path1, "utf8");
    const data = JSON.parse(raw);
    const followers =
      typeof data.followers === "number"
        ? data.followers
        : typeof data.followersCount === "number"
        ? data.followersCount
        : null;
    const updatedAt =
      typeof data.updatedAt === "string"
        ? data.updatedAt
        : typeof data.lastChecked === "string"
        ? data.lastChecked
        : null;
    if (followers !== null) return { followers, updatedAt };
  } catch {
    /* no profile.json — fall through */
  }

  // YouTube fallback: study_yt.py writes `channel_subs_at_ingest: <N>` into
  // each video's frontmatter. Peek at the first video to get a free read.
  if (fallbackVideoFile) {
    try {
      const head = await fsp.readFile(fallbackVideoFile, "utf8");
      const m = head.match(/^channel_subs_at_ingest:\s*(\d+)/m);
      if (m) {
        return { followers: Number(m[1]), updatedAt: null };
      }
    } catch {
      /* ignore */
    }
  }

  return { followers: null, updatedAt: null };
}

async function buildCreatorSummary(
  slug: string
): Promise<CreatorSummary | null> {
  const videos = await getVideoMetasForCreator(slug);
  if (videos.length === 0) return null;

  const totalViews = videos.reduce((s, v) => s + v.views, 0);
  const totalLikes = videos.reduce((s, v) => s + v.likes, 0);
  const dates = videos.map((v) => v.date).filter(Boolean).sort();
  const sources = new Set(videos.map((v) => v.source).filter(Boolean));
  let source: CreatorSummary["source"] = "unknown";
  if (sources.size === 1)
    source =
      (Array.from(sources)[0] as CreatorSummary["source"]) || "unknown";
  else if (sources.size > 1) source = "mixed";

  const [hasPlaybook, hasPatterns, hasVoice] = await Promise.all([
    fsp
      .access(path.join(CONTENT_ROOT, slug, "Playbook.md"))
      .then(() => true)
      .catch(() => false),
    fsp
      .access(path.join(CONTENT_ROOT, slug, "Patterns.md"))
      .then(() => true)
      .catch(() => false),
    fsp
      .access(path.join(CONTENT_ROOT, slug, "Voice.md"))
      .then(() => true)
      .catch(() => false),
  ]);

  const topVideo = videos[0]; // already sorted by views desc
  const profileUrl = buildProfileUrl(slug, source, topVideo?.url);
  const firstVideoFile = topVideo
    ? path.join(CONTENT_ROOT, slug, "videos", `${topVideo.filename}.md`)
    : null;
  const { followers, updatedAt: followersUpdatedAt } = await readProfile(
    slug,
    firstVideoFile
  );
  return {
    slug,
    displayName: slug,
    videoCount: videos.length,
    totalViews,
    totalLikes,
    avgViews: Math.round(totalViews / videos.length),
    topVideoViews: Math.max(...videos.map((v) => v.views)),
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null,
    hasPlaybook,
    hasPatterns,
    hasVoice,
    isSelf: hasVoice,
    source,
    avatar: `/avatars/${slug}.jpg`,
    topVideoThumb: topVideo?.thumbnail || null,
    profileUrl,
    followers,
    followersUpdatedAt,
  };
}

export async function getCreator(slug: string): Promise<CreatorSummary | null> {
  const creators = await getCreators();
  return creators.find((c) => c.slug === slug) || null;
}

export async function getCreatorDoc(
  slug: string,
  doc: "Playbook" | "Patterns" | "Voice"
): Promise<string | null> {
  const filepath = path.join(CONTENT_ROOT, slug, `${doc}.md`);
  let raw: string;
  try {
    raw = await fsp.readFile(filepath, "utf8");
  } catch {
    return null;
  }
  const body = matter(raw).content;
  return resolveWikiLinks(slug, body);
}

// Replace Obsidian-style [[shortcode]] references with markdown links to the
// resolved video. Unknown shortcodes are left as plain text so they don't
// render as broken brackets.
async function resolveWikiLinks(
  slug: string,
  body: string
): Promise<string> {
  if (!body.includes("[[")) return body;
  const metas = await getVideoMetasForCreator(slug);
  if (metas.length === 0) return body;

  const byShortcode = new Map(metas.map((m) => [m.shortcode, m]));
  const slugPath = encodeURIComponent(slug);

  return body.replace(
    /\[\[([A-Za-z0-9_-]+)(?:\|([^\]]+))?\]\]/g,
    (full, id: string, alias?: string) => {
      const meta = byShortcode.get(id);
      if (!meta) return full;
      const label = alias?.trim() || meta.title;
      const href = `/${slugPath}/videos/${encodeURIComponent(meta.filename)}`;
      return `[${label}](${href})`;
    }
  );
}

export async function getVideoMetasForCreator(
  slug: string
): Promise<VideoMeta[]> {
  const videosDir = path.join(CONTENT_ROOT, slug, "videos");
  const stat = await safeStat(videosDir);
  if (!stat) return [];

  const cached = creatorMetasCache.get(slug);
  if (cached && cached.mtime === stat.mtimeMs) return cached.value;

  const inflight = creatorMetasInFlight.get(slug);
  if (inflight) return inflight;

  const job = (async () => {
    const files = (await fsp.readdir(videosDir))
      .filter((f) => f.endsWith(".md"))
      .sort();

    const metas = (
      await mapWithConcurrency(files, READ_CONCURRENCY, (f) =>
        getVideoMeta(path.join(videosDir, f))
      )
    )
      .filter((v): v is VideoMeta => v !== null)
      .sort((a, b) => b.views - a.views);

    creatorMetasCache.set(slug, { mtime: stat.mtimeMs, value: metas });
    return metas;
  })();

  creatorMetasInFlight.set(slug, job);
  try {
    return await job;
  } finally {
    creatorMetasInFlight.delete(slug);
  }
}

export async function getVideo(
  slug: string,
  videoId: string
): Promise<VideoFull | null> {
  const videosDir = path.join(CONTENT_ROOT, slug, "videos");
  if (!safeStatSync(videosDir)) return null;

  const decoded = decodeURIComponent(videoId);

  // 1) Direct filename hit.
  const direct = path.join(videosDir, `${decoded}.md`);
  if (safeStatSync(direct)) return getVideoFull(direct);

  // 2) Prefix match — listing only, no parsing.
  const files = (await fsp.readdir(videosDir)).filter((f) => f.endsWith(".md"));
  const prefixHit = files.find((f) => f.startsWith(decoded));
  if (prefixHit) return getVideoFull(path.join(videosDir, prefixHit));

  // 3) Shortcode via cached metas.
  const metas = await getVideoMetasForCreator(slug);
  const byShortcode = metas.find(
    (m) => m.shortcode === videoId || m.shortcode === decoded
  );
  if (byShortcode) {
    return getVideoFull(path.join(videosDir, `${byShortcode.filename}.md`));
  }
  return null;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}
