import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/**
 * Build an SSE-formatted frame from any JSON-serializable payload.
 */
export function sseEvent(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Calls `onLine` for every complete line in the stream. Flushes any trailing
 * (newline-less) data when `flush()` is invoked.
 */
export function createLineSplitter(onLine: (line: string) => void) {
  let buf = "";
  const decoder = new TextDecoder();
  return {
    push(chunk: Buffer | string) {
      buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line.length > 0) onLine(line);
      }
    },
    flush() {
      if (buf.length > 0) {
        const remaining = buf.replace(/\r$/, "");
        buf = "";
        if (remaining.length > 0) onLine(remaining);
      }
    },
  };
}

export type SpawnStreamOpts = {
  cmd: string;
  args: string[];
  stdin?: string;
  signal: AbortSignal;
  /**
   * When true (default), kill the child process if the client disconnects.
   * Set to false for fire-and-forget jobs (scrape, analyze) so they finish
   * even after the user closes the modal.
   */
  killOnAbort?: boolean;
  /** Called for each line on stdout. */
  onStdoutLine: (line: string, enqueue: (frame: Uint8Array) => void) => void;
  /** Called for each line on stderr. Defaults to forwarding as a log frame. */
  onStderrLine?: (line: string, enqueue: (frame: Uint8Array) => void) => void;
  /** Called once the child exits (or errors). Append final frames here. */
  onExit?: (
    code: number | null,
    signalName: NodeJS.Signals | null,
    enqueue: (frame: Uint8Array) => void,
  ) => void;
};

/**
 * Spawns a child process and returns a ReadableStream that emits SSE frames.
 * Handles backpressure (via enqueue), client-abort kill, and line-buffered IO.
 */
export function spawnSseStream(opts: SpawnStreamOpts): ReadableStream<Uint8Array> {
  const { cmd, args, stdin, signal, onStdoutLine, onStderrLine, onExit } = opts;
  const killOnAbort = opts.killOnAbort !== false;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let child: ChildProcessWithoutNullStreams;
      let closed = false;

      const enqueue = (frame: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(frame);
        } catch {
          // Controller already closed by client disconnect; ignore.
        }
      };

      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      try {
        child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
      } catch (err) {
        enqueue(
          sseEvent({ type: "log", line: `[spawn-error] ${(err as Error).message}` }),
        );
        enqueue(sseEvent({ type: "done", success: false }));
        safeClose();
        return;
      }

      const stdoutSplitter = createLineSplitter((line) => onStdoutLine(line, enqueue));
      const stderrSplitter = createLineSplitter((line) => {
        if (onStderrLine) onStderrLine(line, enqueue);
        else enqueue(sseEvent({ type: "log", line }));
      });

      child.stdout.on("data", (chunk: Buffer) => stdoutSplitter.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => stderrSplitter.push(chunk));

      child.on("error", (err) => {
        enqueue(sseEvent({ type: "log", line: `[child-error] ${err.message}` }));
      });

      const onAbort = () => {
        try {
          if (!child.killed) child.kill("SIGTERM");
          // Force-kill if it doesn't exit in 5s.
          setTimeout(() => {
            if (!child.killed) {
              try {
                child.kill("SIGKILL");
              } catch {
                // ignore
              }
            }
          }, 5000).unref?.();
        } catch {
          // ignore
        }
      };

      if (killOnAbort) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      child.on("close", async (code, signalName) => {
        stdoutSplitter.flush();
        stderrSplitter.flush();
        try {
          // onExit may be async (e.g. cache invalidation); await so the
          // final `done` enqueue lands BEFORE we close the stream.
          await onExit?.(code, signalName, enqueue);
        } catch (err) {
          enqueue(
            sseEvent({ type: "log", line: `[onExit-error] ${(err as Error).message}` }),
          );
        }
        safeClose();
      });

      // Pipe stdin if provided, then close it.
      if (stdin !== undefined) {
        try {
          child.stdin.write(stdin, (err) => {
            if (err) {
              enqueue(
                sseEvent({ type: "log", line: `[stdin-error] ${err.message}` }),
              );
            }
            try {
              child.stdin.end();
            } catch {
              // ignore
            }
          });
        } catch (err) {
          enqueue(
            sseEvent({ type: "log", line: `[stdin-error] ${(err as Error).message}` }),
          );
          try {
            child.stdin.end();
          } catch {
            // ignore
          }
        }
      } else {
        try {
          child.stdin.end();
        } catch {
          // ignore
        }
      }
    },
  });
}

/**
 * Best-effort slug extraction from an Instagram/YouTube profile string.
 * Strips leading `@`, trims whitespace, drops trailing slashes, takes last
 * path segment for URLs.
 */
export function slugFromProfile(profile: string): string {
  let s = profile.trim();
  if (!s) return s;
  // URL: take last non-empty path segment.
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const parts = u.pathname.split("/").filter(Boolean);
      s = parts[parts.length - 1] ?? "";
    } catch {
      // fall through
    }
  }
  s = s.replace(/^@+/, "").replace(/\/+$/g, "");
  return s.toLowerCase();
}
