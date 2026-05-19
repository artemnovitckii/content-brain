import type { NextRequest } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { SSE_HEADERS, spawnSseStream, sseEvent } from "../_lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const VAULT_DIR =
  process.env.CONTENT_BRAIN_ROOT ||
  process.env.STUDY_OUTPUT_DIR ||
  path.resolve(process.cwd(), "..", "content-brain");

type Body = {
  slug?: string;
  mode?: "patterns_playbook" | "voice";
};

function buildPrompt(slug: string, mode: "patterns_playbook" | "voice"): string {
  if (mode === "patterns_playbook") {
    return `Read ${VAULT_DIR}/CLAUDE.md for the protocol. Then analyze the creator ${slug} following Trigger 1 — read their all.md thoroughly, then write ${slug}/Patterns.md and ${slug}/Playbook.md to match the cindiezhu quality bar. Match cindiezhu/Patterns.md and Playbook.md depth and specificity. Use [[shortCode]] wikilinks for specific reels.`;
  }
  return `Read ${VAULT_DIR}/CLAUDE.md for the protocol. Then analyze ${slug} as the self account (Trigger 2) — read their all.md thoroughly and write ${slug}/Voice.md. Quote verbatim tics, include sentence-length stats, opening/closing moves, recurring phrases.`;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim();
  const mode = body.mode;
  if (!slug) {
    return Response.json({ error: "slug is required" }, { status: 400 });
  }
  if (mode !== "patterns_playbook" && mode !== "voice") {
    return Response.json(
      { error: "mode must be 'patterns_playbook' or 'voice'" },
      { status: 400 },
    );
  }

  const prompt = buildPrompt(slug, mode);

  const args = [
    "--print",
    "--add-dir",
    VAULT_DIR,
    "--permission-mode",
    "bypassPermissions",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--no-session-persistence",
    "--verbose",
  ];

  const stream = spawnSseStream({
    cmd: CLAUDE_BIN,
    args,
    stdin: prompt,
    signal: req.signal,
    killOnAbort: false,
    onStdoutLine: (line, enqueue) => {
      // stream-json emits one JSON object per line.
      try {
        const data = JSON.parse(line);
        enqueue(sseEvent({ type: "chunk", data }));
      } catch {
        // Not JSON — surface as log for debugging.
        enqueue(sseEvent({ type: "log", line }));
      }
    },
    onStderrLine: (line, enqueue) => {
      enqueue(sseEvent({ type: "log", line }));
    },
    onExit: async (code, _sig, enqueue) => {
      // Wipe the creators-index disk cache so the next page render picks up
      // the new Patterns/Playbook/Voice files. macOS HFS doesn't always bump
      // the parent dir mtime when a file is added, so the index can go stale.
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
      enqueue(sseEvent({ type: "done", success: code === 0 }));
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
