import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { SSE_HEADERS, slugFromProfile, spawnSseStream, sseEvent } from "../_lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Repo root is one level up from web-app/ by default. Override via env.
const REEL_TRANSCRIBER_DIR =
  process.env.REEL_TRANSCRIBER_ROOT ||
  path.resolve(process.cwd(), "..");
const STUDY_IG_PY = `${REEL_TRANSCRIBER_DIR}/study.py`;
const STUDY_YT_PY = `${REEL_TRANSCRIBER_DIR}/study_yt.py`;
const STUDY_TT_PY = `${REEL_TRANSCRIBER_DIR}/study_tt.py`;
const PYTHON =
  process.env.PYTHON_BIN || `${REEL_TRANSCRIBER_DIR}/.venv/bin/python`;
const FETCH_PROFILE = `${REEL_TRANSCRIBER_DIR}/fetch_profile.py`;

// Run profile fetch (avatar + followers) in the background. Best-effort,
// fire-and-forget — we don't block the SSE stream on it. Stdout/stderr get
// forwarded to the SSE log so the user sees progress.
function spawnProfileFetch(
  slug: string,
  platform: "instagram" | "youtube" | "tiktok",
  enqueueLog: (line: string) => void,
) {
  const child = spawn(PYTHON, [FETCH_PROFILE, slug, "--platform", platform], {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const forward = (chunk: Buffer) =>
    chunk
      .toString("utf8")
      .split("\n")
      .filter((l) => l.length > 0)
      .forEach((l) => enqueueLog(`[profile] ${l}`));
  child.stdout.on("data", forward);
  child.stderr.on("data", forward);
  child.on("error", (e) => enqueueLog(`[profile] spawn error: ${e.message}`));
}

type Platform = "instagram" | "youtube" | "tiktok";

type Body = {
  profile?: string;
  platform?: Platform;
  limit?: number;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const profile = (body.profile ?? "").trim();
  const platform = body.platform;
  const limit = typeof body.limit === "number" && body.limit > 0 ? body.limit : 60;

  if (!profile) {
    return Response.json({ error: "profile is required" }, { status: 400 });
  }
  if (
    platform !== "instagram" &&
    platform !== "youtube" &&
    platform !== "tiktok"
  ) {
    return Response.json(
      { error: "platform must be 'instagram', 'youtube', or 'tiktok'" },
      { status: 400 },
    );
  }

  const scriptPy =
    platform === "instagram"
      ? STUDY_IG_PY
      : platform === "youtube"
      ? STUDY_YT_PY
      : STUDY_TT_PY;
  const cmd = PYTHON;
  const args = [scriptPy, profile, "--limit", String(limit)];
  const slug = slugFromProfile(profile);

  // Capture an enqueue handle so the parallel profile fetch can also push
  // its log lines into the same SSE stream.
  let sseEnqueue: ((line: string) => void) | null = null;

  const stream = spawnSseStream({
    cmd,
    args,
    signal: req.signal,
    killOnAbort: false,
    onStdoutLine: (line, enqueue) => {
      if (!sseEnqueue) {
        sseEnqueue = (l) => enqueue(sseEvent({ type: "log", line: l }));
        // Kick off the profile fetch now that we have a way to forward logs.
        spawnProfileFetch(slug, platform, sseEnqueue);
      }
      enqueue(sseEvent({ type: "log", line }));
    },
    onStderrLine: (line, enqueue) => {
      enqueue(sseEvent({ type: "log", line }));
    },
    onExit: async (code, _sig, enqueue) => {
      if (code === 0) {
        try {
          const cacheDir = path.join(process.cwd(), ".next", "cache", "content-brain");
          const entries = await fs.readdir(cacheDir).catch(() => [] as string[]);
          for (const f of entries) {
            if (f.startsWith("creators-index.")) {
              await fs.unlink(path.join(cacheDir, f)).catch(() => {});
            }
          }
        } catch {
          /* best-effort */
        }
      }
      enqueue(sseEvent({ type: "done", success: code === 0, slug }));
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
