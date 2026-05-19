"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIN_WIDTH = 360;
const DEFAULT_WIDTH = 672; // matches former max-w-2xl
const MAX_RATIO = 0.95; // 95% of viewport

export function ResizableDrawer({
  open,
  onClose,
  storageKey = "chat-drawer-width",
  children,
  header,
}: {
  open: boolean;
  onClose: () => void;
  storageKey?: string;
  children: React.ReactNode;
  header: React.ReactNode;
}) {
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const dragging = useRef(false);

  // Hydrate from localStorage once on mount
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (saved && saved >= MIN_WIDTH) {
        setWidth(Math.min(saved, window.innerWidth * MAX_RATIO));
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  // Persist when width changes (debounced via rAF)
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      /* ignore */
    }
  }, [storageKey, width]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    []
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      // Drawer is anchored to the right edge. Width = viewportRight - mouseX.
      const next = window.innerWidth - e.clientX;
      const clamped = Math.max(
        MIN_WIDTH,
        Math.min(next, window.innerWidth * MAX_RATIO)
      );
      setWidth(clamped);
    },
    []
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      dragging.current = false;
      try {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
    []
  );

  // Esc closes the drawer
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{ width }}
      className="fixed inset-y-0 right-0 z-50 flex flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl"
    >
      {/* Drag handle on the LEFT edge */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-ew-resize"
        aria-label="Resize drawer"
        role="separator"
      >
        <div className="mx-auto h-full w-px bg-zinc-800 transition group-hover:bg-emerald-500/60" />
        <div className="absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-700 opacity-0 transition group-hover:opacity-100" />
      </div>

      {header}
      <div className="flex-1 overflow-hidden p-4">{children}</div>
    </div>
  );
}
