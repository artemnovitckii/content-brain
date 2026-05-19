#!/usr/bin/env node
// Re-scrapes given Instagram creators via Apify, writes
// content-brain/<creator>/_apify_raw.json, then runs the thumb downloader.
//
// Usage: APIFY_TOKEN=xxx node scripts/scrape-and-download.mjs mavgpt artem.novitckii
//
// Apify's run-sync endpoint blocks until the run finishes and returns the
// dataset directly. Default timeout is 5 minutes; raise via APIFY_TIMEOUT.

import fs from "fs/promises";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const TOKEN = process.env.APIFY_TOKEN;
if (!TOKEN) {
  console.error("Missing APIFY_TOKEN env var.");
  process.exit(1);
}

const usernames = process.argv.slice(2);
if (usernames.length === 0) {
  console.error("Usage: APIFY_TOKEN=xxx node scrape-and-download.mjs <user> [<user>...]");
  process.exit(1);
}

const RESULTS_LIMIT = Number(process.env.RESULTS_LIMIT) || 60;
const TIMEOUT_SECS = Number(process.env.APIFY_TIMEOUT) || 600;
const CONTENT_ROOT =
  process.env.CONTENT_BRAIN_ROOT ||
  process.env.CONTENT_ROOT ||
  process.env.STUDY_OUTPUT_DIR ||
  path.resolve(__dirname, "..", "..", "content-brain");

const ACTOR = "apify~instagram-reel-scraper";

async function scrapeOne(username) {
  console.log(`\n→ Scraping ${username} (limit ${RESULTS_LIMIT})...`);
  const url =
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items` +
    `?token=${TOKEN}&timeout=${TIMEOUT_SECS}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: [username],
      resultsLimit: RESULTS_LIMIT,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const items = await res.json();
  if (!Array.isArray(items)) {
    throw new Error(`Unexpected response shape: ${JSON.stringify(items).slice(0, 200)}`);
  }
  console.log(`  got ${items.length} items`);

  const dest = path.join(CONTENT_ROOT, username, "_apify_raw.json");
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, JSON.stringify(items, null, 2), "utf8");
  console.log(`  wrote ${dest}`);
}

async function runDownloader() {
  console.log("\n→ Running thumb downloader...");
  await new Promise((resolve, reject) => {
    const child = spawn(
      "node",
      [path.join(__dirname, "download-thumbnails.mjs")],
      { stdio: "inherit" }
    );
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`exit ${code}`))
    );
  });
}

async function main() {
  for (const u of usernames) {
    try {
      await scrapeOne(u);
    } catch (e) {
      console.error(`✗ ${u} failed: ${e.message}`);
    }
  }
  await runDownloader();
  console.log("\nDone. Run `npm run build && npm run start` to see the new thumbs.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
