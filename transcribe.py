#!/usr/bin/env python3
"""Transcribe an Instagram reel (or any yt-dlp-supported URL) via Groq Whisper."""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from groq import Groq


def download_audio(url: str, out_dir: Path) -> Path:
    template = str(out_dir / "audio.%(ext)s")
    ytdlp = Path(__file__).parent / ".venv" / "bin" / "yt-dlp"
    cmd = [
        str(ytdlp),
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "5",
        "-o", template,
        "--no-playlist",
        "--quiet",
        "--no-warnings",
        url,
    ]
    subprocess.run(cmd, check=True)
    files = list(out_dir.glob("audio.*"))
    if not files:
        raise RuntimeError("yt-dlp produced no audio file")
    return files[0]


def transcribe(audio_path: Path, model: str, language: str | None) -> str:
    client = Groq()
    with audio_path.open("rb") as f:
        kwargs = {
            "file": (audio_path.name, f.read()),
            "model": model,
            "response_format": "text",
        }
        if language:
            kwargs["language"] = language
        return client.audio.transcriptions.create(**kwargs)


def main() -> int:
    p = argparse.ArgumentParser(description="Transcribe an Instagram reel URL.")
    p.add_argument("url", help="Instagram reel URL (or any yt-dlp-supported URL)")
    p.add_argument(
        "--model",
        default="whisper-large-v3-turbo",
        help="Groq model (default: whisper-large-v3-turbo; use whisper-large-v3 for best accuracy)",
    )
    p.add_argument("--language", help="ISO-639-1 code, e.g. 'en'. Omit to auto-detect.")
    p.add_argument("-o", "--output", help="Write transcript to file instead of stdout.")
    args = p.parse_args()

    if not os.environ.get("GROQ_API_KEY"):
        print("error: GROQ_API_KEY is not set", file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        try:
            print("[1/2] downloading audio...", file=sys.stderr)
            audio = download_audio(args.url, tmp_path)
            print(f"[2/2] transcribing ({args.model})...", file=sys.stderr)
            text = transcribe(audio, args.model, args.language).strip()
        except subprocess.CalledProcessError as e:
            print(f"error: yt-dlp failed (exit {e.returncode})", file=sys.stderr)
            return 1
        except Exception as e:
            print(f"error: {e}", file=sys.stderr)
            return 1

    if args.output:
        Path(args.output).write_text(text + "\n")
        print(f"wrote {args.output}", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
