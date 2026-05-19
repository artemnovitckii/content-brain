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

function creatorSystemPrompt(slug: string): string {
  return `You are a brain trust extracted from the Instagram creator ${slug}. Their full content patterns are in this directory — Patterns.md (how they win), Playbook.md (their structures), all.md (every reel with metrics + transcript), and any Voice.md. When the user asks something, ground your answer in concrete evidence from these files. Quote real hooks, real view counts, real reel shortcodes ([[XYZ]]) when relevant. You're not Claude pretending to be them — you're an analyst of their patterns. Be concise, specific, and useful.`;
}

function vaultSystemPrompt(): string {
  return `You are the user's mega-brain across every creator they've studied. Each creator has Patterns.md + Playbook.md (or Voice.md for self). When the user asks something, synthesize across creators — compare formulas, surface contradictions, highlight what's universal vs creator-specific. Quote real hooks and view counts. Cross-reference using [[shortCode]] wikilinks. Be concise and specific. The user's own Voice.md (artem.novitckii) is the calibration reference for their own style.`;
}

function videoSystemPrompt(slug: string, shortcode: string, filename: string): string {
  return `You are an analyst focused on ONE specific reel by ${slug} (shortcode ${shortcode}, file videos/${filename}.md). The full markdown — captions, hashtags, metrics, and full transcript — is available in this directory. When the user asks something, ground every answer in that one reel's content. Quote the actual transcript when useful. If the user asks about other reels by this creator, you may consult the creator's Patterns.md / Playbook.md in the parent context, but stay anchored to this video. Be concise and specific.`;
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
        ? creatorSystemPrompt(scope.slug)
        : scope.type === "video"
        ? videoSystemPrompt(scope.slug, scope.shortcode, scope.filename)
        : vaultSystemPrompt();

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
