#!/usr/bin/env python3
"""Bulk-fetch a YouTube channel's videos using YouTube's own captions — no Groq/Whisper cost.

Same Obsidian-ready output layout as study.py:
    <channel>/
        all.md / all.html
        Dashboard.md
        videos/
            YYYY-MM-DD · <title>.md     one per video, with aliases: [<video_id>]

Re-running is incremental: per-video files with a matching `shortcode:` in
frontmatter are skipped, so only new videos get pulled.
"""
import argparse
import datetime as _dt
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# Reuse helpers from the IG flow — same conventions, same Obsidian wiring.
from study import (
    DASHBOARD_TEMPLATE,
    YTDLP,
    add_reel_links,
    apply_tags,
    build_combined,
    build_shortcode_index,
    slugify_title,
    write_dashboard,
    write_moc,
)


def normalize_channel(handle: str) -> tuple[str, str]:
    """Resolve any of: @MrBeast | MrBeast | full YouTube URL → (folder_name, channel_url).

    Folder name is the handle stripped of '@' and lowercased.
    Channel URL points at the /videos tab so listings come back newest-first.
    """
    s = handle.strip()
    if s.startswith("http"):
        m = re.search(
            r"youtube\.com/(@[\w.-]+|channel/[\w-]+|c/[\w.-]+|user/[\w.-]+)",
            s,
        )
        if not m:
            raise ValueError(f"can't parse channel from {handle!r}")
        ident = m.group(1)
    elif s.startswith("@"):
        ident = s
    else:
        ident = "@" + s
    folder = ident.split("/")[-1].lstrip("@").lower()
    url = f"https://www.youtube.com/{ident}/videos"
    return folder, url


def list_channel_videos(channel_url: str, limit: int) -> list[dict]:
    """Use yt-dlp --flat-playlist to list videos cheaply (IDs + titles only)."""
    print(f"[ytdlp] listing up to {limit} videos from {channel_url} ...", file=sys.stderr)
    result = subprocess.run(
        [
            str(YTDLP),
            "--flat-playlist",
            "--dump-json",
            "--playlist-end", str(limit),
            "--no-warnings",
            channel_url,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    videos = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            videos.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return videos


_TAG_RE = re.compile(r"<[^>]+>")


def parse_vtt(vtt_text: str) -> str:
    """Strip WebVTT markup and collapse YouTube's progressive-reveal duplicates.

    YouTube auto-captions emit each line multiple times, accumulating words
    until the line scrolls. This walks cues left-to-right and only appends words
    that aren't already the suffix of what we've kept — works for both manual
    captions (no overlap) and auto-captions (full overlap).
    """
    # Collect raw cue text blocks. A real cue block contains a `-->` timing line;
    # skip header / STYLE / NOTE / REGION blocks entirely.
    cues: list[str] = []
    for block in vtt_text.split("\n\n"):
        block_lines = block.split("\n")
        if not any("-->" in ln for ln in block_lines):
            continue
        lines = []
        for line in block_lines:
            stripped = line.strip()
            if not stripped or "-->" in stripped:
                continue
            if re.match(r"^\d+$", stripped):  # cue index
                continue
            # Drop inline tags (<c>, <00:00:01.000>) and HTML entities
            cleaned = _TAG_RE.sub("", stripped)
            cleaned = cleaned.replace("&nbsp;", " ").replace("&amp;", "&")
            cleaned = cleaned.replace("​", "").replace(" ", " ").replace("﻿", "")
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            if cleaned:
                lines.append(cleaned)
        if lines:
            cues.append(" ".join(lines))

    seen: list[str] = []
    for cue in cues:
        words = cue.split()
        if not words:
            continue
        max_overlap = min(len(seen), len(words))
        overlap = 0
        for k in range(max_overlap, 0, -1):
            if seen[-k:] == words[:k]:
                overlap = k
                break
        seen.extend(words[overlap:])

    return " ".join(seen).strip()


def fetch_video(video_url: str, tmp_dir: Path) -> tuple[dict, str, str]:
    """Pull info JSON + subtitles for one video. Returns (info, transcript, sub_kind)."""
    template = str(tmp_dir / "%(id)s.%(ext)s")
    subprocess.run(
        [
            str(YTDLP),
            "--write-info-json",
            "--write-subs",
            "--write-auto-subs",
            "--sub-langs", "en,en-US,en-GB,en-orig",
            "--sub-format", "vtt",
            "--skip-download",
            "--sleep-requests", "1",
            "--retries", "5",
            "-o", template,
            "--no-warnings",
            "--quiet",
            video_url,
        ],
        check=True,
    )
    info_files = list(tmp_dir.glob("*.info.json"))
    if not info_files:
        raise RuntimeError("yt-dlp produced no info.json")
    info = json.loads(info_files[0].read_text())

    # Prefer manual subs over auto. yt-dlp writes manual subs without a
    # special suffix; auto-subs end in `.en.vtt` only when no manual exists,
    # so just pick the shortest filename (manual) when multiple are present.
    vtts = sorted(tmp_dir.glob("*.vtt"), key=lambda p: len(p.name))
    transcript = ""
    sub_kind = "none"
    if vtts:
        transcript = parse_vtt(vtts[0].read_text())
        # info.json records which langs were manual vs auto
        manual_langs = (info.get("subtitles") or {}).keys()
        sub_kind = "manual" if manual_langs else "auto"
    return info, transcript, sub_kind


def build_filename(info: dict) -> str:
    date = info.get("upload_date", "")
    if len(date) == 8 and date.isdigit():
        date = f"{date[:4]}-{date[4:6]}-{date[6:8]}"
    title = slugify_title(info.get("title") or "")
    vid = info.get("id", "unknown")
    if title and date:
        return f"{date} · {title}.md"
    if title:
        return f"{title}.md"
    return f"{vid}.md"


def render_video_md(info: dict, transcript: str, sub_kind: str) -> str:
    vid = info.get("id", "")
    url = info.get("webpage_url") or f"https://www.youtube.com/watch?v={vid}"
    date = info.get("upload_date", "")
    if len(date) == 8 and date.isdigit():
        date = f"{date[:4]}-{date[4:6]}-{date[6:8]}"
    title = info.get("title", "") or vid
    views = int(info.get("view_count") or 0)
    likes = int(info.get("like_count") or 0)
    comments = int(info.get("comment_count") or 0)
    duration = float(info.get("duration") or 0)
    channel = info.get("channel") or info.get("uploader") or ""
    description = (info.get("description") or "").strip()
    yt_tags = info.get("tags") or []
    thumbnail = info.get("thumbnail") or ""
    year = date[:4] if len(date) >= 4 else ""
    title_wc = len((info.get("title") or "").split())
    desc_wc = len(description.split())
    transcript_wc = len(transcript.split())
    sub_count = int(info.get("channel_follower_count") or 0)
    ingested_at = _dt.date.today().isoformat()

    display_title = slugify_title(title) or title or vid

    fm_lines = [
        "---",
        f"shortcode: {vid}",
        f"aliases: [{vid}]",
        f"url: {url}",
        f"thumbnail: {thumbnail}",
        f"date: {date}",
        f"year: {year}",
        f"owner: {channel}",
        f"views: {views}",
        f"likes: {likes}",
        f"comments: {comments}",
        f"duration_seconds: {duration:.1f}",
        f"title_word_count: {title_wc}",
        f"description_word_count: {desc_wc}",
        f"transcript_word_count: {transcript_wc}",
        f"channel_subs_at_ingest: {sub_count}",
        f"source: youtube",
        f"captions: {sub_kind}",
        f"ingested_at: {ingested_at}",
    ]
    if yt_tags:
        # Map YouTube tags into the `hashtags:` slot so apply_tags/add_reel_links
        # (shared with the IG flow) pick them up unchanged.
        safe = [re.sub(r"[\[\],]", "", t) for t in yt_tags[:20]]
        fm_lines.append(f"hashtags: [{', '.join(safe)}]")
    fm_lines.append("---")

    body = [
        f"# {display_title}",
        "",
        f"**Date:** {date}  ",
        f"**Views:** {views:,} | **Likes:** {likes:,} | **Comments:** {comments:,}  ",
        f"**Duration:** {duration:.1f}s | **Captions:** {sub_kind}  ",
        f"**URL:** {url}",
        "",
        "## Description",
        "",
        description or "_(no description)_",
        "",
        "## Transcript",
        "",
        transcript or "_(no transcript available)_",
    ]
    return "\n".join(fm_lines) + "\n\n" + "\n".join(body) + "\n"


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("channel", help="YouTube channel: @MrBeast, MrBeast, or full URL")
    p.add_argument("--limit", type=int, default=50, help="Max videos to fetch (default: 50)")
    p.add_argument(
        "--max-duration",
        type=int,
        default=3600,
        help="Skip videos longer than this many seconds (default: 3600 = 1h; 0 = no limit)",
    )
    p.add_argument(
        "--out",
        help="Output dir (default: $STUDY_OUTPUT_DIR/<channel>/ or ./<channel>/ if unset)",
    )
    p.add_argument("--no-combine", action="store_true", help="Skip building all.md/all.html")
    p.add_argument("--no-dashboard", action="store_true", help="Skip generating Dashboard.md")
    args = p.parse_args()

    try:
        folder, channel_url = normalize_channel(args.channel)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    if args.out:
        out_dir = Path(args.out).expanduser()
    elif os.environ.get("STUDY_OUTPUT_DIR"):
        out_dir = Path(os.environ["STUDY_OUTPUT_DIR"]).expanduser() / folder
    else:
        out_dir = Path(folder)
    videos_dir = out_dir / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)

    try:
        listing = list_channel_videos(channel_url, args.limit)
    except subprocess.CalledProcessError as e:
        print(f"error: yt-dlp channel listing failed (exit {e.returncode})", file=sys.stderr)
        return 1
    print(f"[ytdlp] got {len(listing)} videos", file=sys.stderr)

    (out_dir / "_ytdlp_listing.json").write_text(
        json.dumps(listing, indent=2, ensure_ascii=False)
    )

    existing = build_shortcode_index(videos_dir)

    new_count = skip_count = fail_count = long_count = 0
    for i, entry in enumerate(listing, 1):
        vid = entry.get("id")
        url = entry.get("url") or (f"https://www.youtube.com/watch?v={vid}" if vid else None)
        if not vid or not url:
            continue
        if vid in existing:
            print(f"[{i}/{len(listing)}] {vid} — cached, skipping", file=sys.stderr)
            skip_count += 1
            continue
        dur = entry.get("duration") or 0
        if args.max_duration and dur and dur > args.max_duration:
            print(f"[{i}/{len(listing)}] {vid} — {dur:.0f}s > {args.max_duration}s, skipping", file=sys.stderr)
            long_count += 1
            continue
        try:
            print(f"[{i}/{len(listing)}] {vid} — fetching subs + metadata...", file=sys.stderr)
            with tempfile.TemporaryDirectory() as tmp:
                info, transcript, sub_kind = fetch_video(url, Path(tmp))
            target_name = build_filename(info)
            target_path = videos_dir / target_name
            if target_path.exists():
                stem = target_name.rsplit(".md", 1)[0]
                target_path = videos_dir / f"{stem} [{vid}].md"
            target_path.write_text(render_video_md(info, transcript, sub_kind))
            existing[vid] = target_path
            new_count += 1
        except subprocess.CalledProcessError as e:
            print(f"[{i}/{len(listing)}] {vid} — yt-dlp FAILED (exit {e.returncode})", file=sys.stderr)
            fail_count += 1
        except Exception as e:
            print(f"[{i}/{len(listing)}] {vid} — FAILED: {e}", file=sys.stderr)
            fail_count += 1

    if not args.no_combine:
        md_path, html_path = build_combined(out_dir, folder)
        print(f"\n[combined] wrote {md_path}", file=sys.stderr)
        if html_path:
            print(f"[combined] wrote {html_path}", file=sys.stderr)

    apply_tags(out_dir, folder)
    add_reel_links(out_dir, folder)
    print("[tags+links] applied tags and Related links", file=sys.stderr)

    if not args.no_dashboard:
        write_dashboard(out_dir, folder)

    write_moc(out_dir.parent)

    print(
        f"\nDone. new={new_count}, cached={skip_count}, "
        f"too_long={long_count}, failed={fail_count}\n"
        f"Output dir: {out_dir.resolve()}\n"
        f"\nNext: in Claude Code, ask 'analyze {folder}' to generate Patterns.md and Playbook.md.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
