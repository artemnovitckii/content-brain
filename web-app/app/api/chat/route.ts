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
  return `You are an analyst of the creator **${slug}**.

Their content vault is at: \`${dir}\`

START by reading these files in order (use your Read tool):
1. \`${dir}/Patterns.md\` — how they win (hooks, structure, CTAs, view counts)
2. \`${dir}/Playbook.md\` — fill-in-the-blank templates derived from their patterns
3. \`${dir}/all.md\` — every reel with metrics + transcripts (large; spot-check sections relevant to the question)

Then answer the user's question grounded in concrete evidence from THIS creator's data:
- Quote real hooks verbatim
- Cite real view counts
- Reference reels by their shortcode (\`[[XYZ]]\`)
- Compare top performers to flops with specific numbers

You're not pretending to be them — you're an analyst of their patterns. Be concise and specific.`;
}

function vaultSystemPrompt(dir: string): string {
  return `You are the **content-brain mega-analyst** with access to multiple creators' analyzed patterns. The user has studied each creator deeply and you're the synthesis layer across all of them.

The vault lives at: \`${dir}\`

START every conversation by:
1. Run \`ls ${dir}\` (each directory = one creator they've analyzed)
2. Read \`${dir}/CLAUDE.md\` for the analysis protocol
3. For each creator relevant to the user's question, read \`${dir}/<creator>/Patterns.md\` and \`${dir}/<creator>/Playbook.md\`

**Your default mode is "best of the best."** Surface the strongest patterns across ALL creators, ranked by evidence. Quote actual hooks verbatim. Cite real view counts. Compare formulas across creators — what's universal vs unique to one. When suggesting new content, draw from the highest-performing formulas in the vault.

Format every claim with concrete receipts: \`[[shortCode]]\` wiki-links and view counts. No vague advice.

**Important — voice handling:**
- A \`Voice.md\` file at \`${dir}/<creator>/Voice.md\` belongs to the user themselves (the protocol uses it for self-analysis).
- DO NOT default to writing in the user's voice. The point of this tool is to find what works across viral creators, NOT to mimic the user.
- Only reference Voice.md if the user *explicitly* asks for something "in my voice", "in my style", or "for me personally". Otherwise, ignore Voice.md and stay in pure-analyst mode.
- If no Voice.md exists in the vault, that's normal — the user hasn't scraped their own account, just other creators.

Be concise. Be specific. Lead with the receipts.`;
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

Stay anchored to this specific video unless the user explicitly asks to zoom out. Be concise and specific. Lead with the receipts.`;
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
