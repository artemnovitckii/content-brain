#!/usr/bin/env python3
"""Fetch a creator's profile data (followers, full name, avatar) and write
profile.json + avatar image.

Usage:
    fetch_profile.py <slug> --platform instagram|tiktok|youtube

For Instagram, uses Apify's instagram-profile-scraper (~$0.001 per call).
For TikTok and YouTube, uses yt-dlp (free).

Writes:
    $STUDY_OUTPUT_DIR/<slug>/profile.json
        { "followers": int, "fullName": str, "profilePicUrl": str,
          "bio": str, "platform": str, "updatedAt": "YYYY-MM-DD" }

    $AVATAR_OUTPUT_DIR/<slug>.jpg
        (default: web-app/public/avatars/ relative to this script)
"""
import argparse
import datetime as _dt
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen, Request

import requests

HERE = Path(__file__).parent
YTDLP = HERE / ".venv" / "bin" / "yt-dlp"
DEFAULT_AVATAR_DIR = HERE / "web-app" / "public" / "avatars"

APIFY_PROFILE_ACTOR = "apify~instagram-profile-scraper"


def download_image(url: str, dest: Path) -> bool:
    try:
        req = Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept": "image/webp,image/avif,image/*,*/*;q=0.8",
            },
        )
        with urlopen(req, timeout=30) as r:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.read())
        return True
    except Exception as e:
        print(f"  image download failed: {e}", file=sys.stderr)
        return False


def fetch_instagram(username: str) -> dict:
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        raise RuntimeError("APIFY_TOKEN not set")
    url = (
        f"https://api.apify.com/v2/acts/{APIFY_PROFILE_ACTOR}"
        f"/run-sync-get-dataset-items?token={token}&timeout=300"
    )
    print(f"  → Apify profile scrape for {username}…", flush=True)
    resp = requests.post(url, json={"usernames": [username]}, timeout=400)
    resp.raise_for_status()
    items = resp.json()
    if not items:
        raise RuntimeError("Apify returned no items")
    p = items[0]
    return {
        "followers": p.get("followersCount") or 0,
        "fullName": p.get("fullName") or "",
        "profilePicUrl": p.get("profilePicUrl") or p.get("profilePicUrlHD") or "",
        "bio": p.get("biography") or "",
    }


def fetch_via_ytdlp(profile_url: str) -> dict:
    """Use yt-dlp to dump channel/user JSON. Works for TikTok + YouTube."""
    print(f"  → yt-dlp profile dump for {profile_url}…", flush=True)
    cmd = [
        str(YTDLP),
        "--dump-single-json",
        "--playlist-end", "1",
        "--no-warnings",
        "--quiet",
        profile_url,
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True)
    data = json.loads(out.stdout)
    # yt-dlp dump for a channel returns playlist-like JSON with entries
    followers = (
        data.get("channel_follower_count")
        or data.get("uploader_follower_count")
        or data.get("playlist_count")
        or 0
    )
    full_name = data.get("channel") or data.get("uploader") or data.get("title") or ""
    # yt-dlp gives "thumbnails" array — biggest one
    pic_url = ""
    thumbs = data.get("thumbnails") or []
    if thumbs:
        # Pick the largest by width if available, else last
        with_w = [t for t in thumbs if isinstance(t, dict) and t.get("width")]
        if with_w:
            pic_url = sorted(with_w, key=lambda t: t.get("width", 0))[-1].get("url", "")
        else:
            pic_url = thumbs[-1].get("url", "") if isinstance(thumbs[-1], dict) else ""
    return {
        "followers": followers,
        "fullName": full_name,
        "profilePicUrl": pic_url,
        "bio": data.get("description") or "",
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("slug", help="creator slug (folder name in vault)")
    p.add_argument("--platform", choices=["instagram", "tiktok", "youtube"], required=True)
    p.add_argument("--avatar-dir", help="override avatar output dir")
    p.add_argument("--vault", help="override vault root (else uses $STUDY_OUTPUT_DIR)")
    args = p.parse_args()

    vault = Path(args.vault or os.environ.get("STUDY_OUTPUT_DIR", ""))
    if not vault:
        print("error: STUDY_OUTPUT_DIR not set and --vault not provided", file=sys.stderr)
        return 2

    avatar_dir = Path(args.avatar_dir) if args.avatar_dir else DEFAULT_AVATAR_DIR

    try:
        if args.platform == "instagram":
            data = fetch_instagram(args.slug)
        elif args.platform == "tiktok":
            data = fetch_via_ytdlp(f"https://www.tiktok.com/@{args.slug}")
        else:  # youtube
            data = fetch_via_ytdlp(f"https://www.youtube.com/@{args.slug}")
    except Exception as e:
        print(f"profile fetch failed: {e}", file=sys.stderr)
        return 1

    profile = {
        **data,
        "platform": args.platform,
        "updatedAt": _dt.date.today().isoformat(),
    }

    creator_dir = vault / args.slug
    creator_dir.mkdir(parents=True, exist_ok=True)
    (creator_dir / "profile.json").write_text(json.dumps(profile, indent=2), encoding="utf-8")
    print(f"  ✓ wrote {creator_dir / 'profile.json'} (followers: {data['followers']:,})")

    pic_url = data.get("profilePicUrl")
    if pic_url:
        avatar_path = avatar_dir / f"{args.slug}.jpg"
        if avatar_path.exists():
            print(f"  ✓ avatar already exists at {avatar_path}")
        elif download_image(pic_url, avatar_path):
            print(f"  ✓ wrote avatar to {avatar_path}")
    else:
        print("  (no profile pic url found)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
