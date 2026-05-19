# Content Brain

A personal "second brain" for studying viral creators. Scrape any Instagram / TikTok / YouTube creator, transcribe their videos with Whisper, extract their hook formulas and playbooks with Claude, then **chat with their brain** in a local webapp.

```
┌─────────────────────────────────────────────────────────────┐
│  localhost:3000 — the only thing you'll ever touch          │
│  ─────────────────────────────────────────                  │
│  + Add creator       → scrape any IG/TikTok/YT profile      │
│  Analyze button      → Claude writes their Patterns/Playbook │
│  Chat button         → talk to one creator's brain          │
│  Mega-brain page     → synthesize across all of them        │
└─────────────────────────────────────────────────────────────┘
```

Everything runs **locally** on your machine. The only AI it uses is your **Claude Code subscription** (no separate API key needed). Costs to run: ~$0 for analysis/chat (covered by subscription), ~$0.003 per Instagram reel scraped (Apify), free for TikTok/YouTube/transcription.

---

## Quickstart (with Claude Code — recommended)

If you have [Claude Code](https://claude.ai/code) installed, this is the easy path:

```bash
git clone <this-repo>
cd reel_transcriber
cp .env.example .env
```

Open `.env` in your editor and paste two keys:
- `GROQ_API_KEY` — get free at [console.groq.com/keys](https://console.groq.com/keys)
- `APIFY_TOKEN` — get at [console.apify.com](https://console.apify.com/account/integrations) (paid, but cheap)

Then open the folder in VS Code, open Claude Code, and type:

> **set this up**

Claude reads `CLAUDE.md` in the repo root and runs the entire install: deps, venv, npm packages, vault setup, build. Takes 2-3 minutes. When it says "Setup done," run:

```bash
cd web-app && npm run start
```

Open **http://localhost:3000**. That's it.

---

## Manual install (no Claude Code)

If you don't have Claude Code installed, install everything yourself:

### Prerequisites

```bash
# macOS only — Linux untested, Windows not supported
brew install python@3.12 node ffmpeg yt-dlp
```

### API keys

```bash
cp .env.example .env
# edit .env, paste GROQ_API_KEY + APIFY_TOKEN
```

### Python + Node

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

cd web-app
npm install
npm run build
npm run start
```

Open **http://localhost:3000**.

---

## What you can do from the UI

### Add a creator

Click `+ Add creator` in the top-right of the home page.
- Paste a username (`@mrbeast` or just `mrbeast`) or a full profile URL
- Pick Instagram / TikTok / YouTube
- Set a reel limit (default 60)
- Hit **Start** and watch the scrape log live

Under the hood: it runs Apify (IG) or yt-dlp (TT/YT) to list videos, downloads audio for each, transcribes with Groq Whisper, writes markdown into the vault.

### Analyze a creator

Click into any creator, hit the **Analyze** button in the header. Claude (your subscription) reads their `all.md` and writes `Patterns.md` + `Playbook.md`. Takes 1-3 minutes per creator.

### Chat with a creator

Three places to start a chat:
- **Mega-brain** (top of home page) — synthesizes across all your creators
- **Chat** button on a creator page — scoped to that one creator's transcripts + analysis
- **Chat with this reel** on a single-video page — grounded in one reel only

All chats use your Claude Code subscription. Drawer is drag-to-resize.

### Pull latest

On any creator's page, click **Pull latest** to fetch their 10 most recent reels. Incremental — existing shortcodes are skipped.

---

## Vault structure

The vault lives at `./content-brain/` (override with `STUDY_OUTPUT_DIR` env var):

```
content-brain/
├── CLAUDE.md                   ← analysis protocol (do not delete)
├── mrbeast/
│   ├── all.md                  ← all reels + metadata + transcripts (Claude reads this)
│   ├── videos/<id>.md          ← one file per reel
│   ├── _apify_raw.json         ← raw scrape (for thumbnails)
│   ├── profile.json            ← follower count + bio
│   ├── Dashboard.md            ← auto-generated Dataview queries
│   ├── Patterns.md             ← Claude writes this
│   └── Playbook.md             ← Claude writes this
└── (your account)/
    ├── ...
    └── Voice.md                ← Claude writes your style DNA instead
```

It's **plain markdown** — open the folder in [Obsidian](https://obsidian.md) and you get a knowledge graph for free.

---

## Troubleshooting

**`npm run dev` is heavy on memory.** Next 16 dev mode uses 1-2GB baseline. For daily use, prefer `npm run build && npm run start` — it's much lighter. Reserve dev mode for when you're editing the app code.

**Instagram thumbnails missing.** Apify CDN URLs expire ~72 hours after scrape. Click **Pull latest** on the affected creator (or `npm run thumbs` from `web-app/`) to re-download.

**"Claude can't find the vault"** during analysis or chat. Check `.env` — either `STUDY_OUTPUT_DIR` is set correctly, or you have a `content-brain/` directory at the repo root.

**Cindiezhu's profile fetch returns 0 followers.** Her Instagram account was banned and Apify can't read it. Not a bug.

---

## Architecture

```
Browser ──→ Next.js webapp ──→ /api/* SSE routes ──→ child processes
                                                     ├─ python study*.py    (scrape)
                                                     ├─ python fetch_profile.py (avatar+followers)
                                                     └─ claude --print      (analyze + chat)
```

- **Frontend**: Next.js 16 + React 19, server components, mtime-cached vault reader
- **Scraping**: Python (Apify SDK + yt-dlp + Groq Whisper)
- **AI**: spawns the `claude` CLI in `--print` mode with `--session-id` for chat persistence
- **Data**: plain markdown in `content-brain/`, gitignored

---

## License

Personal use. Adapt freely.
