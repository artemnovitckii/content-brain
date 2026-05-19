import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Load the repo-root .env (sibling of web-app/) into process.env BEFORE the
// server starts, so spawned Python scripts inherit GROQ_API_KEY / APIFY_TOKEN
// / STUDY_OUTPUT_DIR without needing per-script dotenv wiring.
function loadRootEnv() {
  const envPath = resolve(__dirname, "..", ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (process.env[key]) continue; // env already-set wins
    process.env[key] = val.replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadRootEnv();

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  productionBrowserSourceMaps: false,
  experimental: {
    preloadEntriesOnStart: false,
    serverSourceMaps: false,
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;
