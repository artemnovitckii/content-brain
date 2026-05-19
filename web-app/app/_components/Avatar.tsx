"use client";

import { useState } from "react";

const PALETTES: [string, string][] = [
  ["from-emerald-400", "to-teal-500"],
  ["from-fuchsia-400", "to-purple-600"],
  ["from-amber-400", "to-rose-500"],
  ["from-sky-400", "to-indigo-600"],
  ["from-lime-400", "to-emerald-600"],
  ["from-orange-400", "to-pink-500"],
];

function paletteFor(slug: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  }
  return PALETTES[Math.abs(hash) % PALETTES.length];
}

function initialsOf(slug: string): string {
  const cleaned = slug.replace(/[._-]/g, " ").trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  slug,
  src,
  size = 56,
  className = "",
}: {
  slug: string;
  src: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [from, to] = paletteFor(slug);

  if (failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`flex items-center justify-center rounded-full bg-gradient-to-br ${from} ${to} text-zinc-950 font-semibold ${className}`}
      >
        <span style={{ fontSize: size * 0.36 }}>{initialsOf(slug)}</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={slug}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      className={`rounded-full object-cover ${className}`}
    />
  );
}
