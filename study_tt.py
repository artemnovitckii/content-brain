#!/usr/bin/env python3
"""Bulk-fetch a TikTok creator's videos via yt-dlp, transcribe each via Groq Whisper.

Same output layout as study.py / study_yt.py:

    <username>/
        all.md
        all.html
        Dashboard.md
        videos/
            <shortCode>.md

Re-running is incremental: any <shortCode>.md that exists is reused.

Uses:
- yt-dlp (free) to list and download metadata + audio
- Groq Whisper (free tier) to transcribe (TikTok has no captions like YouTube does)
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

# Reuse everything we can from the IG scraper — same Groq transcription,
# same markdown rendering, same tagging / dashboard generation.
from study import (
    transcribe_audio,
    build_reel_filename,
    render_reel_md,
    apply_tags,
    add_reel_links,
    write_moc,
    write_dashboard,
    build_combined,
    build_shortcode_index,
    migrate_filenames,
)

HERE = Path(__file__).parent
YTDLP = HERE / ".venv" / "bin" / "yt-dlp"


def normalize_handle(handle: str) -> tuple[str, str]:
    """Resolve any of: @user | user | tiktok.com URL → (folder_name, profile_url)."""
    h = handle.strip()
    # Full URL
    if h.startswith("http"):
        m = re.search(r"tiktok\.com/@([^/?#]+)", h)
        if not m:
            raise ValueError(f"Could not parse TikTok handle from URL: {handle}")
        return m.group(1), f"https://www.tiktok.com/@{m.group(1)}"
    # Strip leading @
    if h.startswith("@"):
        h = h[1:]
    return h, f"https://www.tiktok.com/@{h}"


def list_user_videos(profile_url: str, limit: int) -> list[dict]:
    """Use yt-dlp --flat-playlist to list videos cheaply."""
    cmd = [
        str(YTDLP),
        "--flat-playlist",
        "--dump-json",
        "--playlist-end", str(limit),
        "--no-warnings",
        "--quiet",
        profile_url,
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    items: list[dict] = []
    for line in out.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return items


def fetch_video(video_url: str, tmp_dir: Path) -> tuple[dict, Path]:
    """Download a video's info.json + audio via yt-dlp. Returns (info, audio_path)."""
    cmd = [
        str(YTDLP),
        "--write-info-json",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "5",  # decent quality, smaller files
        "--sleep-requests", "1",
        "--retries", "5",
        "--no-warnings",
        "--quiet",
        "--output", str(tmp_dir / "%(id)s.%(ext)s"),
        video_url,
    ]
    subprocess.run(cmd, check=True, capture_output=True)

    info_files = list(tmp_dir.glob("*.info.json"))
    if not info_files:
        raise RuntimeError("yt-dlp produced no info.json")
    info = json.loads(info_files[0].read_text())

    audio_files = list(tmp_dir.glob("*.mp3"))
    if not audio_files:
        raise RuntimeError("yt-dlp produced no audio file")
    return info, audio_files[0]


def info_to_reel(info: dict) -> dict:
    """Map yt-dlp's TikTok info.json shape to the reel dict expected by render_reel_md."""
    description = info.get("description") or info.get("title") or ""
    # TikTok hashtags come embedded in the description (#foo #bar). Extract.
    hashtags = re.findall(r"#(\w+)", description)
    # Strip hashtags out of the caption body for readability
    caption = re.sub(r"\s*#\w+", "", description).strip()

    ts = info.get("timestamp")
    timestamp_iso = ""
    if ts:
        try:
            timestamp_iso = _dt.datetime.fromtimestamp(int(ts), tz=_dt.timezone.utc).isoformat()
        except (TypeError, ValueError):
            pass

    music = {}
    if info.get("track") or info.get("artist"):
        music = {
            "artist_name": info.get("artist") or info.get("uploader") or "",
            "song_name": info.get("track") or "Original sound",
        }

    return {
        "shortCode": info.get("id", ""),
        "url": info.get("webpage_url") or f"https://www.tiktok.com/@{info.get('uploader_id','')}/video/{info.get('id','')}",
        "timestamp": timestamp_iso,
        "likesCount": info.get("like_count") or 0,
        "videoPlayCount": info.get("view_count") or 0,
        "videoViewCount": info.get("view_count") or 0,
        "commentsCount": info.get("comment_count") or 0,
        "videoDuration": info.get("duration") or 0,
        "caption": caption,
        "hashtags": hashtags,
        "mentions": [m.lstrip("@") for m in re.findall(r"@(\w+)", description)],
        "taggedUsers": [],
        "ownerUsername": info.get("uploader_id") or info.get("uploader") or "",
        "musicInfo": music,
    }


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("handle", help="TikTok handle: @user, user, or full profile URL")
    p.add_argument("--limit", type=int, default=50, help="Max videos to fetch (default: 50)")
    p.add_argument("--out", help="Override output base directory")
    p.add_argument("--no-combine", action="store_true")
    p.add_argument("--no-dashboard", action="store_true")
    args = p.parse_args()

    if not os.environ.get("GROQ_API_KEY"):
        print("error: GROQ_API_KEY is not set", file=sys.stderr)
        return 2

    try:
        username, profile_url = normalize_handle(args.handle)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    if args.out:
        out_dir = Path(args.out).expanduser() / username
    elif os.environ.get("STUDY_OUTPUT_DIR"):
        out_dir = Path(os.environ["STUDY_OUTPUT_DIR"]).expanduser() / username
    else:
        out_dir = Path.cwd() / username
    videos_dir = out_dir / "videos"
    videos_dir.mkdir(parents=True, exist_ok=True)

    print(f"→ Listing videos for {profile_url} (limit {args.limit})…", flush=True)
    try:
        listing = list_user_videos(profile_url, args.limit)
    except subprocess.CalledProcessError as e:
        print(f"error: yt-dlp listing failed: {e.stderr or e.stdout}", file=sys.stderr)
        return 1
    print(f"  found {len(listing)} videos", flush=True)

    migrate_filenames(videos_dir)
    index = build_shortcode_index(videos_dir)

    new_count = 0
    skipped = 0
    failed = 0

    for i, item in enumerate(listing, 1):
        vid = item.get("id") or item.get("display_id") or ""
        if not vid:
            continue
        if vid in index:
            skipped += 1
            print(f"[{i}/{len(listing)}] {vid} — already exists, skipping", flush=True)
            continue

        # yt-dlp's flat listing doesn't give us a canonical URL field reliably;
        # build one from the uploader handle + id.
        video_url = item.get("url") or f"https://www.tiktok.com/@{username}/video/{vid}"

        try:
            with tempfile.TemporaryDirectory() as td:
                tmp = Path(td)
                print(f"[{i}/{len(listing)}] {vid} — fetching…", flush=True)
                info, audio_path = fetch_video(video_url, tmp)
                print(f"[{i}/{len(listing)}] {vid} — transcribing ({audio_path.name})…", flush=True)
                transcript = transcribe_audio(audio_path)
            reel = info_to_reel(info)
            md = render_reel_md(reel, transcript)
            fname = build_reel_filename(reel)
            (videos_dir / fname).write_text(md, encoding="utf-8")
            new_count += 1
            print(f"[{i}/{len(listing)}] {vid} — wrote {fname}", flush=True)
        except subprocess.CalledProcessError as e:
            failed += 1
            err = (e.stderr or b"").decode("utf-8", "replace")[:200] if isinstance(e.stderr, bytes) else (e.stderr or "")[:200]
            print(f"[{i}/{len(listing)}] {vid} — FAILED: {err}", file=sys.stderr, flush=True)
        except Exception as e:
            failed += 1
            print(f"[{i}/{len(listing)}] {vid} — FAILED: {e}", file=sys.stderr, flush=True)

    print(f"\n→ Tagging + linking…", flush=True)
    apply_tags(out_dir, username)
    add_reel_links(out_dir, username)

    if not args.no_dashboard:
        write_dashboard(out_dir, username)
    if not args.no_combine:
        build_combined(out_dir, username)

    # MOC update
    vault_root = out_dir.parent
    write_moc(vault_root)

    print(f"\n✓ Done. {new_count} new, {skipped} skipped, {failed} failed.")
    print(f"  Output: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
