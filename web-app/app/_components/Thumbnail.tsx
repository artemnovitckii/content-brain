"use client";

import { useState } from "react";

const PALETTES: [string, string][] = [
  ["from-emerald-900", "to-zinc-900"],
  ["from-fuchsia-900", "to-zinc-900"],
  ["from-amber-900", "to-zinc-900"],
  ["from-sky-900", "to-zinc-900"],
  ["from-rose-900", "to-zinc-900"],
];

function paletteFor(key: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return PALETTES[Math.abs(hash) % PALETTES.length];
}

export function Thumbnail({
  src,
  alt,
  shortcode,
  className = "",
  aspect = "9/16",
}: {
  src: string | null;
  alt: string;
  shortcode: string;
  className?: string;
  aspect?: string;
}) {
  const [failed, setFailed] = useState(!src);
  const [from, to] = paletteFor(shortcode);

  if (failed || !src) {
    return (
      <div
        style={{ aspectRatio: aspect }}
        className={`bg-gradient-to-br ${from} ${to} ${className}`}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      style={{ aspectRatio: aspect }}
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}
