# Content Brain — Operating Manual for Claude Code

You are running inside the **Content Brain** repo. This is a personal tool that scrapes Instagram / TikTok / YouTube creators, transcribes their videos, and extracts viral patterns via Claude analysis — all browsable in a local webapp at `localhost:3000`.

**Your job here has two modes:**

1. **First-time setup** — when the user clones the repo and says something like "set this up", "install this", "get this running", or "i just downloaded this".
2. **Development assistance** — once the system is running, helping the user iterate on the codebase.

This document handles mode 1. For mode 2, just work normally — read code, edit files, run tests.

---

## Mode 1: First-time setup

When the user asks you to set this up, walk through these steps **in order**, **out loud** (tell them what you're doing), and **stop on failures**.

### Step 0 — Verify prerequisites

Check that the following tools are installed. For each missing one, tell the user the install command and stop:

```bash
which python3 node brew ffmpeg yt-dlp claude
```

Required:
- **macOS** (Linux untested, Windows not supported — bash wrappers and Brew aren't available)
- **Homebrew** — `https://brew.sh` (Mac install: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`)
- **Python 3.10+** — usually pre-installed on Mac, else `brew install python@3.12`
- **Node 18+** — `brew install node`
- **ffmpeg + yt-dlp** — `brew install ffmpeg yt-dlp`
- **Claude Code CLI** — the user is talking to you, so this is already done

If anything's missing, give the install command, ask the user to run it, then re-check before proceeding.

### Step 1 — Check API keys

Look at `.env` in the repo root.

```bash
test -f .env && cat .env | grep -E "^(GROQ_API_KEY|APIFY_TOKEN)" | sed 's/=.*/=<set>/'
```

If `.env` doesn't exist:
1. Copy `.env.example` to `.env`: `cp .env.example .env`
2. Tell the user: "I need two API keys before I can install. Please open `.env` and paste:
   - `GROQ_API_KEY` — get one free at https://console.groq.com/keys
   - `APIFY_TOKEN` — get one at https://console.apify.com/account/integrations (costs ~$0.003 per reel)
   Let me know when you've saved them and I'll continue."
3. Stop and wait.

If `.env` exists but either key is empty, ask the user to fill it in and wait.

### Step 2 — Python venv + deps

```bash
cd <repo>
python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
```

This takes 20-60 seconds. If it fails, surface the error.

### Step 3 — Node deps

```bash
cd <repo>/web-app
npm install --silent
```

Takes 30-90 seconds.

### Step 4 — Vault directory

The vault holds scraped creator data + the analysis protocol. Default location is `<repo>/content-brain/`.

```bash
mkdir -p <repo>/content-brain
```

The shipped `content-brain/CLAUDE.md` (the analysis protocol — different from this file) should already be there from the git clone. Confirm:

```bash
test -f <repo>/content-brain/CLAUDE.md && echo "protocol present"
```

### Step 5 — Build the webapp

```bash
cd <repo>/web-app
npm run build
```

This should finish in 5-15 seconds. If it fails with a path / env error, double-check `.env` was loaded — the build step does NOT need API keys but should not crash.

### Step 6 — Tell the user how to run it

When everything's green, say exactly this:

> Setup done. Run `npm run start` from the `web-app/` directory to start the server. Then visit **http://localhost:3000** in your browser. Everything else (adding creators, analyzing, chatting) happens through the UI — no more terminal commands needed.

Optionally suggest: "Add your first creator: click `+ Add creator` in the top right, paste an Instagram username (no @), pick the platform, hit Start. You'll see the scrape happen live."

---

## What this system does

- **Scrapes** Instagram / TikTok / YouTube creators (Apify for IG, yt-dlp for TT + YT, Groq Whisper for transcription)
- **Analyzes** each creator with Claude to produce `Patterns.md` (how they win) + `Playbook.md` (steal the structures)
- **Chats** with individual creators ("MrBeast's brain"), single reels, or all of them at once ("Mega-brain")
- **Pulls latest reels** incrementally — scrape adds new shortcodes, leaves existing ones alone
- All powered by the user's **Claude Code subscription** (no separate API key for the AI)

## Key files (when helping with development)

- `study.py`, `study_yt.py`, `study_tt.py` — scrape engines (called by `/api/study`)
- `fetch_profile.py` — fetches follower count + avatar (called alongside study)
- `web-app/lib/content.ts` — reads the vault, mtime-cached, frontmatter-only fast path
- `web-app/app/api/study/route.ts` — spawns scrape Python, streams logs via SSE
- `web-app/app/api/analyze/route.ts` — spawns `claude -p` to write Patterns/Playbook
- `web-app/app/api/chat/route.ts` — spawns `claude -p` with session persistence
- `content-brain/CLAUDE.md` — the analysis protocol that `claude -p` reads when analyzing
- `.env` — secrets, never committed (`.gitignore` enforces)

## Architecture quick-ref

```
Browser ─→ Next.js webapp ─→ /api/* routes ─→ child processes
                                              ├─ python study*.py    (scrape)
                                              ├─ python fetch_profile.py (avatar+followers)
                                              └─ claude --print      (analyze + chat)

Vault (content-brain/) is plain markdown — readable in Obsidian, VS Code, anywhere.
```

## Troubleshooting (mention these only if relevant)

- **Dev mode eats memory:** Next 16 + Turbopack baseline is ~1.3GB. Use `npm run dev` (webpack mode, mrbeast skipped) or `npm run build && npm run start` (production, much lighter).
- **Apify thumbnail URLs expire after ~72h.** If you scrape a creator and don't open the webapp for 3+ days, their thumbnails will fall back to gradient placeholders. Re-scrape via the "Pull latest" button.
- **Claude can't find the vault:** check `.env` has `STUDY_OUTPUT_DIR` set, OR the default `<repo>/content-brain/` exists.
