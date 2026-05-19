# Reel & TikTok Transcriber — Setup Guide

A tool that turns Instagram Reels and TikToks into written text. You paste a link in your Terminal, and a transcript comes back a few seconds later.

You only have to do this setup **once**. After that, transcribing a video takes about 10 seconds.

---

## What you need before you start

- A Mac (any from the last ~5 years works)
- About **10–15 minutes** the first time
- A free **Groq account** (we'll create it together in Step 4)
- The project folder I sent you (probably as a `.zip` file)

You don't need to know any coding. You'll just be copying and pasting commands. If something goes wrong, jump to **Troubleshooting** at the bottom.

---

## A note on Terminal

The Terminal is the app where you type commands instead of clicking buttons. It looks scary but it's just a text box. When this guide says **"paste this and press Enter,"** it means:

1. Click in the Terminal window
2. Press `Cmd + V` to paste
3. Press `Enter` (or `Return`)

If a command asks for your **Mac password**, type it and press Enter. **You won't see anything appear as you type** — no dots, no stars. That's normal. Just type it and press Enter.

---

## Step 1 — Open Terminal

1. Press `Cmd + Space` to open Spotlight Search
2. Type **Terminal**
3. Press `Enter`

A window opens with some text and a blinking cursor. Leave this window open — you'll use it for every step.

---

## Step 2 — Install Homebrew

Homebrew is a free tool that installs other tools you need. If you've never installed it before, paste this into Terminal and press Enter:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It will:

- Ask for your **Mac password** (type it, press Enter — remember, no dots show up)
- Print a lot of text and take **3–5 minutes**
- Finish with a message that says `Installation successful!`

When it finishes, it might tell you to run **two extra commands** to "add Homebrew to your PATH." If it does, copy and paste those exact two commands one at a time. They'll look something like:

```
echo >> /Users/yourname/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

If you already have Homebrew, you can skip this step.

---

## Step 3 — Install ffmpeg

ffmpeg is the tool that processes the video's audio. Paste this and press Enter:

```
brew install ffmpeg
```

Takes 1–2 minutes. When it's done, you'll see your blinking cursor again.

---

## Step 4 — Get a free Groq API key

Groq is the service that turns audio into text. The free tier is generous — you can transcribe hundreds of videos per day for free.

1. Go to **https://console.groq.com** in your browser
2. Sign up with your email (or Google/GitHub login)
3. On the left sidebar, click **API Keys**
4. Click **Create API Key**
5. Give it any name (like `transcriber`) and click Create
6. **A long string starting with `gsk_...` will appear.** Copy it right now and paste it into a notes app — you will **only see it once**. If you lose it, you'll have to create a new one.

Keep this key private. Don't share it or post it online — anyone who has it can use your Groq account.

---

## Step 5 — Put the project files on your Mac

1. Find the **`reel_transcriber.zip`** file I sent you
2. Double-click it to unzip — you should now have a folder called `reel_transcriber`
3. Move that folder somewhere you'll remember, like your **Documents** folder

---

## Step 6 — Tell Terminal to enter the project folder

In Terminal, type the following — but **don't press Enter yet**:

```
cd 
```

(That's the letters `c d` followed by a single space.)

Now **drag the `reel_transcriber` folder from Finder directly onto the Terminal window**. The folder's full path will appear after `cd `. Now press Enter.

You're now "inside" the project folder. Your Terminal prompt usually changes to show this.

---

## Step 7 — Install the project's tools

Paste these two commands, one at a time, pressing Enter after each:

```
python3 -m venv .venv
```

```
.venv/bin/pip install groq yt-dlp curl_cffi
```

The second one takes about a minute. You'll see a lot of `Collecting...` and `Installing...` lines. When it's done, the cursor returns and you're ready for the next step.

---

## Step 8 — Save your Groq key

Now we'll save the Groq key from Step 4 so the tool can use it. Paste this command, but **replace `PASTE_YOUR_KEY_HERE` with the real key** (the long `gsk_...` string):

```
echo "GROQ_API_KEY=PASTE_YOUR_KEY_HERE" > .env
```

Then lock it down so only you can read it:

```
chmod 600 .env
```

---

## Step 9 — Create the `reel` and `tiktok` shortcuts

These shortcuts let you type `reel` or `tiktok` from any folder, without having to be in the project folder. Paste these two commands one at a time:

```
echo 'alias reel="'$(pwd)'/transcribe"' >> ~/.zshrc
```

```
echo 'alias tiktok="'$(pwd)'/transcribe"' >> ~/.zshrc
```

Now make sure the script is allowed to run:

```
chmod +x transcribe transcribe.py
```

**Important:** Close Terminal completely (`Cmd + Q`) and open a fresh Terminal window. The shortcut won't work until you do this.

---

## Step 10 — Try it out!

In your new Terminal window, paste this (with a real Reel URL of your choice):

```
reel "https://www.instagram.com/reel/SOMEID/"
```

**Always wrap the URL in double quotes** like above. URLs often have special characters that confuse Terminal if they're not in quotes.

You'll see:

```
[1/2] downloading audio...
[2/2] transcribing (whisper-large-v3-turbo)...
<the transcript appears here>
```

That's it. You're done.

---

## Everyday usage

```
reel "https://www.instagram.com/reel/XXXX/"
tiktok "https://www.tiktok.com/@user/video/XXXX"
```

Some handy tricks:

- **Copy transcript to clipboard:**
  ```
  reel "URL" | pbcopy
  ```
  Then `Cmd + V` to paste anywhere.

- **Save transcript to a file:**
  ```
  reel "URL" -o transcript.txt
  ```

- **Quick way to copy:** select the transcript text in Terminal and press `Cmd + C`.

---

## Troubleshooting

**"command not found: reel"**
You forgot to close and reopen Terminal after Step 9. Close it completely with `Cmd + Q`, then open a new window.

**"error: GROQ_API_KEY is not set"**
The `.env` file didn't save correctly, or you ran the command from the wrong folder. Go back to Step 8 and make sure you `cd` into the project folder first (Step 6).

**The transcript is wrong / cut off / says weird things**
- Check the URL is wrapped in `"double quotes"` — if not, the shell often slices off part of the URL
- Some videos have music but no speech (so you'll get song lyrics or nothing)
- Private accounts: if the video is from a private account you can't see, you can't transcribe it either

**"command not found: brew"**
Homebrew didn't finish setting up. Re-run those two `eval`/`echo` commands from the end of Step 2 (the ones it printed at you). If you don't remember them, run:
```
eval "$(/opt/homebrew/bin/brew shellenv)"
```

**Anything else**
Send me a screenshot of the Terminal window with the error and I'll help you sort it out.

---

## How much does this cost?

The Groq free tier currently covers way more than typical personal use — you'd have to transcribe hundreds of videos per day to hit the limit. If you ever do, you can add a card and pay per-use, but for normal use it's effectively free.
