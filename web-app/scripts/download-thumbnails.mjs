#!/usr/bin/env node
// Downloads reel thumbnails from each creator's _apify_raw.json into
// web-app/public/thumbs/<creator>/<shortcode>.jpg.
//
// Re-run after every new Apify scrape. Idempotent: skips files that exist.
// Logs expired/failed URLs so you know which need re-scraping.

import fs from "fs/promises";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load <repo>/.env into process.env so we get STUDY_OUTPUT_DIR / CONTENT_BRAIN_ROOT
function loadRootEnv() {
  const envPath = path.resolve(__dirname, "..", "..", ".env");
  if (!existsSync(envPath)) return;
  for (const raw of readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (!process.env[key]) {
      process.env[key] = val.replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}
loadRootEnv();
const CONTENT_ROOT =
  process.env.CONTENT_BRAIN_ROOT ||
  process.env.CONTENT_ROOT ||
  process.env.STUDY_OUTPUT_DIR ||
  path.resolve(__dirname, "..", "..", "content-brain");
const THUMBS_ROOT = path.join(__dirname, "..", "public", "thumbs");
const CONCURRENCY = 8;

async function downloadOne(url, dest) {
  const res = await fetch(url, {
    headers: {
      // Pretend to be a normal browser; IG CDN sometimes 403s otherwise.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Accept: "image/webp,image/avif,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}

async function processCreator(slug) {
  const jsonPath = path.join(CONTENT_ROOT, slug, "_apify_raw.json");
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(jsonPath, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { slug, noJson: true };
    throw e;
  }
  const dir = path.join(THUMBS_ROOT, slug);
  await fs.mkdir(dir, { recursive: true });

  const items = raw
    .map((it) => ({
      shortCode: it.shortCode,
      url: it.displayUrl || (it.images && it.images[0]) || null,
    }))
    .filter((x) => x.shortCode && x.url);

  let done = 0;
  let skipped = 0;
  let failed = 0;

  // Bounded concurrency.
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (true) {
        const j = i++;
        if (j >= items.length) return;
        const { shortCode, url } = items[j];
        const dest = path.join(dir, `${shortCode}.jpg`);
        if (existsSync(dest)) {
          skipped++;
          continue;
        }
        try {
          await downloadOne(url, dest);
          done++;
        } catch (e) {
          failed++;
        }
      }
    })
  );

  return { slug, count: items.length, done, skipped, failed };
}

async function main() {
  if (!existsSync(CONTENT_ROOT)) {
    console.log(`Vault not found at ${CONTENT_ROOT} — nothing to download. (Create it via the webapp's + Add creator button.)`);
    return;
  }
  const entries = await fs.readdir(CONTENT_ROOT, { withFileTypes: true });
  const slugs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name);

  for (const slug of slugs) {
    const result = await processCreator(slug);
    if (result.noJson) {
      console.log(`${slug}: no _apify_raw.json, skipped`);
    } else {
      console.log(
        `${slug}: ${result.done} downloaded, ${result.skipped} already had, ${result.failed} failed (likely expired)`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
