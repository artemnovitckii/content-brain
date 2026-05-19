import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { SSE_HEADERS, spawnSseStream, sseEvent } from "../_lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import path from "node:path";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const VAULT_DIR =
  process.env.CONTENT_BRAIN_ROOT ||
  process.env.STUDY_OUTPUT_DIR ||
  path.resolve(process.cwd(), "..", "content-brain");

type Scope =
  | { type: "creator"; slug: string }
  | { type: "vault" }
  | { type: "video"; slug: string; shortcode: string; filename: string };

type Body = {
  message?: string;
  sessionId?: string;
  scope?: Scope;
};

function creatorSystemPrompt(slug: string, dir: string): string {
  return `You are a brain trust extracted from the creator **${slug}**.

Their full content vault is at: \`${dir}\`

START by reading these files in order (use your Read tool):
1. \`${dir}/Patterns.md\` — how they win (hooks, structure, CTAs)
2. \`${dir}/Playbook.md\` — fill-in-the-blank templates derived from their patterns
3. \`${dir}/Voice.md\` — their tics (if present)
4. \`${dir}/all.md\` — every reel with metrics + transcripts (large; spot-check sections relevant to the question)

Then answer the user's question grounded in concrete evidence. Quote real hooks verbatim, cite real view counts, reference reels by their shortcode ([[XYZ]]). You're not pretending to be them — you're an analyst of their patterns. Be concise and specific.`;
}

function vaultSystemPrompt(dir: string): string {
  return `You are the user's mega-brain across every creator they've studied.

The vault lives at: \`${dir}\`

START every conversation by:
1. Listing creators: use your Bash tool to run \`ls ${dir}\` (each directory = one creator)
2. Reading \`${dir}/CLAUDE.md\` — the analysis protocol that defines the format
3. For each creator relevant to the user's question, read \`${dir}/<creator>/Patterns.md\` and \`${dir}/<creator>/Playbook.md\` (or \`Voice.md\` for the user's own account)

Then synthesize across creators — compare formulas, surface contradictions, highlight what's universal vs creator-specific. Quote real hooks and view counts verbatim. Cross-reference reels using [[shortCode]] wikilinks. Be concise and specific.

The user's own \`Voice.md\` (whichever creator has a Voice.md file is them) is the calibration reference for their own style — use it when suggesting they write something new.`;
}

function videoSystemPrompt(slug: string, shortcode: string, filename: string, dir: string): string {
  return `You are an analyst focused on ONE specific reel by **${slug}** (shortcode ${shortcode}).

The reel's full markdown — caption, hashtags, metrics, full transcript — is at:
\`${dir}/videos/${filename}.md\`

START by reading that file. Then answer the user grounded in that one reel's content. Quote the actual transcript verbatim when useful.

If the user asks about other reels by this creator, you may consult:
- \`${dir}/Patterns.md\` — their overall patterns
- \`${dir}/Playbook.md\` — their templates
- \`${dir}/all.md\` — every reel (large; spot-check)

But stay anchored to this specific video unless the user explicitly asks to zoom out. Be concise and specific.`;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const scope = body.scope;
  if (
    !scope ||
    (scope.type !== "vault" && scope.type !== "creator" && scope.type !== "video") ||
    (scope.type === "creator" && !scope.slug?.trim()) ||
    (scope.type === "video" &&
      (!scope.slug?.trim() || !scope.shortcode?.trim() || !scope.filename?.trim()))
  ) {
    return Response.json({ error: "invalid scope" }, { status: 400 });
  }

  const existingSession = body.sessionId?.trim();
  const isNewSession = !existingSession;
  const sessionId = existingSession || randomUUID();

  let args: string[];
  if (isNewSession) {
    const scopeDir =
      scope.type === "creator" || scope.type === "video"
        ? `${VAULT_DIR}/${scope.slug}`
        : VAULT_DIR;
    const systemPrompt =
      scope.type === "creator"
        ? creatorSystemPrompt(scope.slug, scopeDir)
        : scope.type === "video"
        ? videoSystemPrompt(scope.slug, scope.shortcode, scope.filename, scopeDir)
        : vaultSystemPrompt(scopeDir);

    args = [
      "--print",
      "--session-id",
      sessionId,
      "--add-dir",
      scopeDir,
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--append-system-prompt",
      systemPrompt,
    ];
  } else {
    args = [
      "--print",
      "--resume",
      sessionId,
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
    ];
  }

  const stream = spawnSseStream({
    cmd: CLAUDE_BIN,
    args,
    stdin: message,
    signal: req.signal,
    onStdoutLine: (line, enqueue) => {
      try {
        const data = JSON.parse(line);
        enqueue(sseEvent({ type: "chunk", data }));
      } catch {
        enqueue(sseEvent({ type: "log", line }));
      }
    },
    onStderrLine: (line, enqueue) => {
      enqueue(sseEvent({ type: "log", line }));
    },
    onExit: (_code, _sig, enqueue) => {
      enqueue(sseEvent({ type: "done" }));
    },
  });

  // For new sessions, prepend a session frame so the client can store the UUID.
  let finalStream = stream;
  if (isNewSession) {
    finalStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(sseEvent({ type: "session", sessionId }));
        const reader = stream.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } catch (err) {
          controller.enqueue(
            sseEvent({ type: "log", line: `[stream-error] ${(err as Error).message}` }),
          );
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
      cancel(reason) {
        // Propagate cancel to the underlying stream so the child gets killed.
        return stream.cancel(reason);
      },
    });
  }

  return new Response(finalStream, { headers: SSE_HEADERS });
}
