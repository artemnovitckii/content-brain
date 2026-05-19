#!/usr/bin/env python3
"""Bulk-fetch an Instagram account's reels via Apify and transcribe each via Groq Whisper.

Output layout (under <username>/ in the current directory):

    <username>/
        all.md           combined transcripts + metadata, sorted by views desc
        all.html         same content as HTML (via pandoc)
        videos/
            <shortCode>.md   one rich markdown file per reel (Obsidian-ready)

Re-running on the same profile is incremental: any <shortCode>.md that already
exists is reused, so only new reels get transcribed.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import requests
from groq import Groq

APIFY_ACTOR_ID = "shu8hvrXbJbY3Eb9W"  # apify/instagram-scraper
HERE = Path(__file__).parent
YTDLP = HERE / ".venv" / "bin" / "yt-dlp"


def fetch_reels(profile_url: str, limit: int, token: str) -> list[dict]:
    url = (
        f"https://api.apify.com/v2/acts/{APIFY_ACTOR_ID}"
        f"/run-sync-get-dataset-items?token={token}"
    )
    payload = {
        "addParentData": False,
        "directUrls": [profile_url],
        "resultsLimit": limit,
        "resultsType": "reels",
        "searchLimit": 1,
        "searchType": "hashtag",
    }
    print(f"[apify] fetching up to {limit} reels for {profile_url} ...", file=sys.stderr)
    resp = requests.post(url, json=payload, timeout=600)
    resp.raise_for_status()
    return resp.json()


def download_audio(url: str, out_dir: Path, cookies_browser: str = "") -> Path:
    template = str(out_dir / "audio.%(ext)s")
    cmd = [
        str(YTDLP),
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "5",
        "-o", template,
        "--no-playlist",
        "--sleep-requests", "1",
        "--retries", "3",
        "--quiet",
        "--no-warnings",
    ]
    if cookies_browser:
        cmd += ["--cookies-from-browser", cookies_browser]
    cmd.append(url)
    subprocess.run(cmd, check=True)
    files = list(out_dir.glob("audio.*"))
    if not files:
        raise RuntimeError("yt-dlp produced no audio file")
    return files[0]


def transcribe_audio(audio_path: Path, model: str = "whisper-large-v3-turbo") -> str:
    client = Groq()
    with audio_path.open("rb") as f:
        result = client.audio.transcriptions.create(
            file=(audio_path.name, f.read()),
            model=model,
            response_format="text",
        )
    return result.strip() if isinstance(result, str) else str(result).strip()


_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F600-\U0001F64F"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E6-\U0001F1FF"
    "]+",
    flags=re.UNICODE,
)


def slugify_title(caption: str, max_chars: int = 55) -> str:
    """First meaningful line of a caption, stripped/sanitized for a filename."""
    if not caption:
        return ""
    first_line = caption.strip().split("\n", 1)[0]
    first_line = _EMOJI_RE.sub("", first_line)
    cleaned = re.sub(r'[/\\:*?"<>|]', "", first_line)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -—–.,;:!?")
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars].rsplit(" ", 1)[0] + "..."
    return cleaned


def build_reel_filename(reel: dict) -> str:
    """Filename: 'YYYY-MM-DD · <title>.md'. Falls back to shortcode if no caption."""
    date = (reel.get("timestamp") or "")[:10]
    title = slugify_title(reel.get("caption") or "")
    sc = reel.get("shortCode", "unknown")
    if title and date:
        return f"{date} · {title}.md"
    if title:
        return f"{title}.md"
    return f"{sc}.md"


def _shortcode_from_md(text: str) -> str:
    m = re.search(r"^shortcode:\s*(\S+)", text, re.M)
    return m.group(1).strip() if m else ""


def build_shortcode_index(videos_dir: Path) -> dict[str, Path]:
    """Map of shortcode -> existing file path (for dedupe across renames)."""
    out: dict[str, Path] = {}
    for f in videos_dir.glob("*.md"):
        sc = _shortcode_from_md(f.read_text())
        if sc:
            out[sc] = f
    return out


def migrate_filenames(videos_dir: Path) -> None:
    """Rename existing files to the current desired format and patch their content.

    Idempotent. Per file:
      1. Add `aliases: [<shortcode>]` to frontmatter if missing (so [[shortcode]] wikilinks resolve).
      2. Replace `# <shortcode>` H1 with `# <title>` based on caption.
      3. Rename file to `YYYY-MM-DD · <title>.md` if not already.
    """
    for f in list(videos_dir.glob("*.md")):
        text = f.read_text()
        sc = _shortcode_from_md(text)
        date_m = re.search(r"^date:\s*(\S+)", text, re.M)
        date = date_m.group(1) if date_m else ""
        cap_m = re.search(r"## Caption\s*\n+(.*?)\n## ", text, re.S)
        caption = cap_m.group(1).strip() if cap_m else ""
        title = slugify_title(caption)
        display_title = title or sc

        # 1. Insert aliases line if missing
        if sc and "aliases:" not in text:
            text = re.sub(
                r"(^shortcode:\s*\S+\n)",
                lambda m: m.group(1) + f"aliases: [{sc}]\n",
                text,
                count=1,
                flags=re.M,
            )

        # 2. Update H1
        if sc:
            text = re.sub(rf"^# {re.escape(sc)}\s*$", f"# {display_title}", text, count=1, flags=re.M)

        f.write_text(text)

        # 3. Rename
        target = build_reel_filename({"timestamp": date, "caption": caption, "shortCode": sc})
        target_path = videos_dir / target
        if f.name == target:
            continue
        if target_path.exists() and target_path != f:
            stem = target.rsplit(".md", 1)[0]
            target_path = videos_dir / f"{stem} [{sc}].md"
        f.rename(target_path)


def render_reel_md(reel: dict, transcript: str) -> str:
    sc = reel.get("shortCode", "")
    url = reel.get("url", "")
    date = (reel.get("timestamp") or "")[:10]
    likes = int(reel.get("likesCount") or 0)
    views = int(reel.get("videoPlayCount") or reel.get("videoViewCount") or 0)
    comments = int(reel.get("commentsCount") or 0)
    duration = float(reel.get("videoDuration") or 0)
    caption = (reel.get("caption") or "").strip()
    hashtags = reel.get("hashtags") or []
    mentions = reel.get("mentions") or []
    tagged = [t.get("username") for t in (reel.get("taggedUsers") or []) if t.get("username")]
    owner = reel.get("ownerUsername", "")
    music = reel.get("musicInfo") or {}

    title = slugify_title(caption)
    display_title = title or sc

    fm_lines = [
        "---",
        f"shortcode: {sc}",
        f"aliases: [{sc}]",
        f"url: {url}",
        f"date: {date}",
        f"owner: {owner}",
        f"views: {views}",
        f"likes: {likes}",
        f"comments: {comments}",
        f"duration_seconds: {duration:.1f}",
    ]
    if hashtags:
        fm_lines.append(f"hashtags: [{', '.join(hashtags)}]")
    if mentions:
        fm_lines.append(f"mentions: [{', '.join(mentions)}]")
    if tagged:
        fm_lines.append(f"tagged: [{', '.join(tagged)}]")
    if music.get("song_name"):
        fm_lines.append(f"music: \"{music.get('artist_name','')} — {music.get('song_name','')}\"")
    fm_lines.append("---")

    body = [
        f"# {display_title}",
        "",
        f"**Date:** {date}  ",
        f"**Views:** {views:,} | **Likes:** {likes:,} | **Comments:** {comments:,}  ",
        f"**Duration:** {duration:.1f}s  ",
        f"**URL:** {url}",
        "",
        "## Caption",
        "",
        caption or "_(no caption)_",
        "",
        "## Transcript",
        "",
        transcript or "_(no transcript)_",
    ]
    return "\n".join(fm_lines) + "\n\n" + "\n".join(body) + "\n"


def parse_views_from_md(text: str) -> int:
    m = re.search(r"^views:\s*(\d+)", text, re.MULTILINE)
    return int(m.group(1)) if m else 0


DASHBOARD_TEMPLATE = """---
account: {username}
type: dashboard
---

# {username} — Dashboard

Live queries over the reels in `videos/`. Requires the **Dataview** plugin in Obsidian (Settings → Community plugins → Browse → "Dataview" → Install + Enable).

## Top reels by views

```dataview
TABLE WITHOUT ID
  file.link AS "Reel",
  date AS "Date",
  views AS "Views",
  likes AS "Likes",
  comments AS "Comments",
  duration_seconds AS "Duration"
FROM "{username}/videos"
SORT views DESC
LIMIT 10
```

## Top reels by comments

```dataview
TABLE WITHOUT ID
  file.link AS "Reel",
  comments AS "Comments",
  views AS "Views",
  round(comments * 1000 / views) / 10 AS "Comment %"
FROM "{username}/videos"
SORT comments DESC
LIMIT 10
```

## Highest engagement rate (comment % of views)

```dataview
TABLE WITHOUT ID
  file.link AS "Reel",
  round(comments * 1000 / views) / 10 + "%" AS "Comment Rate",
  views AS "Views"
FROM "{username}/videos"
WHERE views > 10000
SORT (comments / views) DESC
LIMIT 10
```

## Duration vs performance

```dataview
TABLE WITHOUT ID
  file.link AS "Reel",
  duration_seconds AS "Duration",
  views AS "Views"
FROM "{username}/videos"
SORT duration_seconds ASC
```

## Reels by date

```dataview
TABLE WITHOUT ID
  file.link AS "Reel",
  date AS "Date",
  views AS "Views"
FROM "{username}/videos"
SORT date DESC
```

## Underperformers (lowest views)

```dataview
TABLE WITHOUT ID
  file.link AS "Reel",
  views AS "Views",
  duration_seconds AS "Duration"
FROM "{username}/videos"
SORT views ASC
LIMIT 5
```

## Top performers (highest views)

```dataview
TABLE WITHOUT ID
  file.link AS "Reel",
  views AS "Views",
  comments AS "Comments",
  duration_seconds AS "Duration"
FROM "{username}/videos"
SORT views DESC
LIMIT 5
```

## Tagged accounts

```dataview
TABLE WITHOUT ID
  file.link AS "Reel",
  tagged AS "Tagged"
FROM "{username}/videos"
WHERE tagged
SORT views DESC
```

## How to use

1. Install Dataview plugin (Settings → Community plugins → Browse → "Dataview" → Install + Enable).
2. Open this file in **Reading View** (`Cmd+E`) to see rendered tables.
3. Queries auto-refresh whenever you re-run `study {username}`.
4. Click any reel link to jump to its full transcript and caption.
"""


_HASHTAG_NORMALIZE = re.compile(r"[^a-z0-9_-]")


def _normalize_tag(s: str) -> str:
    return _HASHTAG_NORMALIZE.sub("", s.lower().lstrip("#"))


def apply_tags(out_dir: Path, username: str) -> None:
    """Inject Obsidian tags into each reel's frontmatter.

    Tags added per reel:
        account/<username>
        performance/<top|mid|low>   (percentile within this account)
        duration/<short|medium|long>
        topic/<each-hashtag-from-caption>
    """
    videos_dir = out_dir / "videos"
    files = list(videos_dir.glob("*.md"))
    if not files:
        return

    # Pass 1: collect views/duration/hashtags
    parsed = []
    for f in files:
        text = f.read_text()
        views = parse_views_from_md(text)
        dur_m = re.search(r"^duration_seconds:\s*([\d.]+)", text, re.M)
        duration = float(dur_m.group(1)) if dur_m else 0.0
        tags_m = re.search(r"^hashtags:\s*\[(.*?)\]", text, re.M)
        hashtags: list[str] = []
        if tags_m:
            hashtags = [h.strip() for h in tags_m.group(1).split(",") if h.strip()]
        parsed.append({"path": f, "text": text, "views": views, "duration": duration, "hashtags": hashtags})

    # Compute view-percentile cutoffs for top/mid/low tiers
    sorted_views = sorted(p["views"] for p in parsed)
    n = len(sorted_views)
    if n >= 3:
        top_cutoff = sorted_views[int(n * 2 / 3)]
        mid_cutoff = sorted_views[int(n / 3)]
    else:
        top_cutoff = mid_cutoff = 0

    # Pass 2: build tag list per reel and write back
    for p in parsed:
        v = p["views"]
        if v >= top_cutoff and v > 0:
            perf = "top"
        elif v >= mid_cutoff:
            perf = "mid"
        else:
            perf = "low"

        d = p["duration"]
        dur_bucket = "short" if d < 20 else ("medium" if d < 60 else "long")

        tags = [
            f"account/{username}",
            f"performance/{perf}",
            f"duration/{dur_bucket}",
        ]
        for h in p["hashtags"]:
            norm = _normalize_tag(h)
            if norm:
                tags.append(f"topic/{norm}")

        tags_yaml = "tags:\n" + "\n".join(f"  - {t}" for t in tags)
        text = p["text"]

        # Remove any prior tags: block (and its bullets)
        text = re.sub(r"^tags:\s*\n(?:  - [^\n]*\n)+", "", text, flags=re.M)

        # Inject before the closing --- of the frontmatter
        text = re.sub(
            r"(\A---\n.*?)(\n---\n)",
            lambda m: m.group(1) + "\n" + tags_yaml + m.group(2),
            text,
            count=1,
            flags=re.S,
        )
        p["path"].write_text(text)


def add_reel_links(out_dir: Path, username: str) -> None:
    """Append a 'Related' section to each reel with wikilinks to:
        - the account's Patterns/Playbook (hubs)
        - one topic note per hashtag (cluster centers)
        - the account's all.md
    Idempotent: removes any prior Related section before re-adding.
    """
    videos_dir = out_dir / "videos"
    files = list(videos_dir.glob("*.md"))
    if not files:
        return

    for f in files:
        text = f.read_text()
        # Strip prior Related section (if any) — everything from `## Related` to EOF
        text = re.sub(r"\n+## Related\b.*?\Z", "", text, flags=re.S)

        # Parse hashtags from frontmatter
        m = re.search(r"^hashtags:\s*\[(.*?)\]", text, re.M)
        hashtags = []
        if m:
            hashtags = [h.strip() for h in m.group(1).split(",") if h.strip()]

        topic_links = " · ".join(f"[[topics/{_normalize_tag(h)}|{_normalize_tag(h)}]]" for h in hashtags if _normalize_tag(h))

        related = [
            "",
            "## Related",
            "",
            f"- Account hub → [[{username}/Patterns|{username} Patterns]] · [[{username}/Playbook|Playbook]] · [[{username}/all|all reels]]",
        ]
        if topic_links:
            related.append(f"- Topics → {topic_links}")
        related.append("")

        f.write_text(text.rstrip() + "\n" + "\n".join(related))


def write_moc(vault_root: Path) -> None:
    """Build/update _Home.md at the vault root with links to every account."""
    if not vault_root.is_dir():
        return
    accounts = []
    for entry in sorted(vault_root.iterdir()):
        if not entry.is_dir() or entry.name.startswith((".", "_")):
            continue
        if not (entry / "videos").is_dir():
            continue
        accounts.append(entry)

    lines = [
        "---",
        "type: MOC",
        "---",
        "",
        "# Content Brain",
        "",
        f"_{len(accounts)} account(s) tracked._",
        "",
        "## Accounts",
        "",
    ]
    for acc in accounts:
        lines.append(f"### {acc.name}")
        for fname in ("Patterns", "Playbook", "Dashboard", "all"):
            if (acc / f"{fname}.md").exists():
                lines.append(f"- [[{acc.name}/{fname}|{fname}]]")
        lines.append("")
    lines.extend([
        "## Tag clusters",
        "",
        "- Top performers across all accounts: `#performance/top`",
        "- Flops to study what kills reels: `#performance/low`",
        "- Long-form reels (>60s): `#duration/long`",
        "- Click any tag in the right sidebar to filter the graph.",
        "",
    ])
    (vault_root / "_Home.md").write_text("\n".join(lines))
    print(f"[moc] wrote {vault_root / '_Home.md'}", file=sys.stderr)


def write_dashboard(out_dir: Path, username: str) -> None:
    """Write the Obsidian Dataview dashboard. Pure template, no LLM."""
    videos_dir = out_dir / "videos"
    if not videos_dir.exists() or not any(videos_dir.glob("*.md")):
        return
    (out_dir / "Dashboard.md").write_text(DASHBOARD_TEMPLATE.format(username=username))
    print(f"[dashboard] wrote {out_dir / 'Dashboard.md'}", file=sys.stderr)


def build_combined(out_dir: Path, username: str) -> tuple[Path, Path | None]:
    videos_dir = out_dir / "videos"
    files = sorted(videos_dir.glob("*.md"))
    files.sort(key=lambda p: parse_views_from_md(p.read_text()), reverse=True)

    parts = [
        f"# {username} — {len(files)} reels",
        "",
        "_Sorted by views (descending)._",
        "",
        "---",
        "",
    ]
    for md_file in files:
        content = md_file.read_text()
        # Strip frontmatter for combined view
        content = re.sub(r"\A---\n.*?\n---\n+", "", content, count=1, flags=re.S)
        parts.append(content.rstrip())
        parts.append("\n---\n")

    md_text = "\n".join(parts)
    md_path = out_dir / "all.md"
    md_path.write_text(md_text)

    html_path: Path | None = out_dir / "all.html"
    try:
        subprocess.run(
            ["pandoc", "-s", "-f", "markdown", "-t", "html", "-o", str(html_path)],
            input=md_text,
            text=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as e:
        print(f"warning: pandoc HTML conversion skipped ({e})", file=sys.stderr)
        html_path = None
    return md_path, html_path


def normalize_profile(profile: str) -> tuple[str, str]:
    s = profile.strip().lstrip("@")
    if s.startswith("http"):
        # https://www.instagram.com/<username>/ ...
        m = re.search(r"instagram\.com/([^/?#]+)", s)
        if not m:
            raise ValueError(f"can't parse username from {profile!r}")
        username = m.group(1)
    else:
        username = s
    url = f"https://www.instagram.com/{username}/"
    return username, url


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("profile", help="Instagram profile URL or @username (e.g. cindiezhu)")
    p.add_argument("--limit", type=int, default=50, help="Max reels to fetch (default: 50)")
    p.add_argument(
        "--out",
        help="Output dir (default: $STUDY_OUTPUT_DIR/<username>/ or ./<username>/ if unset)",
    )
    p.add_argument("--no-combine", action="store_true", help="Skip building all.md/all.html")
    p.add_argument("--no-dashboard", action="store_true", help="Skip generating Dashboard.md")
    p.add_argument(
        "--cookies-from-browser",
        default="",
        help="Browser to pull IG cookies from (chrome, safari, firefox, edge, brave). "
             "Required to scrape >~100 reels — IG rate-limits anonymous traffic.",
    )
    args = p.parse_args()

    if not os.environ.get("GROQ_API_KEY"):
        print("error: GROQ_API_KEY is not set", file=sys.stderr)
        return 2
    if not os.environ.get("APIFY_TOKEN"):
        print("error: APIFY_TOKEN is not set", file=sys.stderr)
        return 2

    try:
        username, profile_url = normalize_profile(args.profile)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    if args.out:
        out_dir = Path(args.out).expanduser()
    elif os.environ.get("STUDY_OUTPUT_DIR"):
        out_dir = Path(os.environ["STUDY_OUTPUT_DIR"]).expanduser() / username
    else:
        out_dir = Path(username)
    videos_dir = out_dir / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)

    try:
        reels = fetch_reels(profile_url, args.limit, os.environ["APIFY_TOKEN"])
    except requests.HTTPError as e:
        print(f"error: Apify request failed: {e} — body: {e.response.text[:500]}", file=sys.stderr)
        return 1
    print(f"[apify] got {len(reels)} reels", file=sys.stderr)

    # Save the raw Apify response for debugging / future re-use
    (out_dir / "_apify_raw.json").write_text(json.dumps(reels, indent=2, ensure_ascii=False))

    # Migrate any old shortcode-named files to the new "date · title" format
    migrate_filenames(videos_dir)
    # Build the dedupe index from frontmatter so renames don't cause re-transcription
    existing = build_shortcode_index(videos_dir)

    new_count = skip_count = fail_count = 0
    for i, reel in enumerate(reels, 1):
        sc = reel.get("shortCode")
        url = reel.get("url")
        if not sc or not url:
            continue
        if sc in existing:
            print(f"[{i}/{len(reels)}] {sc} — cached, skipping", file=sys.stderr)
            skip_count += 1
            continue
        try:
            print(f"[{i}/{len(reels)}] {sc} — downloading audio...", file=sys.stderr)
            with tempfile.TemporaryDirectory() as tmp:
                audio = download_audio(url, Path(tmp), args.cookies_from_browser)
                print(f"[{i}/{len(reels)}] {sc} — transcribing...", file=sys.stderr)
                transcript = transcribe_audio(audio)
            target_name = build_reel_filename(reel)
            target_path = videos_dir / target_name
            # Collision guard: append shortcode if a different reel already owns this filename
            if target_path.exists():
                stem = target_name.rsplit(".md", 1)[0]
                target_path = videos_dir / f"{stem} [{sc}].md"
            target_path.write_text(render_reel_md(reel, transcript))
            existing[sc] = target_path
            new_count += 1
        except subprocess.CalledProcessError as e:
            print(f"[{i}/{len(reels)}] {sc} — yt-dlp FAILED (exit {e.returncode})", file=sys.stderr)
            fail_count += 1
        except Exception as e:
            print(f"[{i}/{len(reels)}] {sc} — FAILED: {e}", file=sys.stderr)
            fail_count += 1

    if not args.no_combine:
        md_path, html_path = build_combined(out_dir, username)
        print(f"\n[combined] wrote {md_path}", file=sys.stderr)
        if html_path:
            print(f"[combined] wrote {html_path}", file=sys.stderr)

    apply_tags(out_dir, username)
    add_reel_links(out_dir, username)
    print(f"[tags+links] applied tags and Related links to per-reel frontmatter", file=sys.stderr)

    if not args.no_dashboard:
        write_dashboard(out_dir, username)

    write_moc(out_dir.parent)

    print(
        f"\nDone. new={new_count}, cached={skip_count}, failed={fail_count}\n"
        f"Output dir: {out_dir.resolve()}\n"
        f"\nNext: in Claude Code, ask 'analyze {username}' to generate Patterns.md and Playbook.md.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
