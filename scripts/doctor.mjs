#!/usr/bin/env node
/**
 * `npm run doctor` — checks configuration and clearly identifies missing
 * services/credentials, for both the Next.js app and (if present) the
 * agent worker's .env file.
 *
 * This is deliberately offline-first: it checks that required env vars
 * are SET and don't look like placeholders, and optionally does a live
 * reachability check for Supabase/LiveKit if network access is available
 * and --live is passed. It does NOT validate that keys are actually
 * correct/authorized (that requires a real API call per provider) —
 * treat a clean doctor run as "configured," not "guaranteed working."
 */
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LIVE = process.argv.includes("--live");

const PLACEHOLDER_PATTERNS = [/^$/, /your[-_]?/i, /^xxx/i, /^changeme/i, /^<.*>$/];

function looksLikePlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(value.trim()));
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return vars;
}

function checkGroup(title, envVars, required) {
  console.log(`\n${title}`);
  let allOk = true;
  for (const key of required) {
    const value = envVars?.[key];
    if (!value || looksLikePlaceholder(value)) {
      console.log(`  ✗ ${key} — missing or placeholder`);
      allOk = false;
    } else {
      const masked = value.length > 8 ? value.slice(0, 4) + "…" + value.slice(-4) : "set";
      console.log(`  ✓ ${key} (${masked})`);
    }
  }
  return allOk;
}

console.log("Dhva AI — configuration doctor");
console.log("================================");

// --- Next.js app ---
const nextEnvPath = path.join(ROOT, ".env.local");
const nextEnv = parseEnvFile(nextEnvPath);
if (!nextEnv) {
  console.log(`\n✗ ${nextEnvPath} not found — copy .env.example to .env.local first.`);
} else {
  checkGroup("Next.js app (.env.local)", nextEnv, [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "NEXT_PUBLIC_LIVEKIT_URL",
  ]);

  const lkUrl = nextEnv.NEXT_PUBLIC_LIVEKIT_URL;
  if (lkUrl && !looksLikePlaceholder(lkUrl) && !lkUrl.startsWith("ws://") && !lkUrl.startsWith("wss://")) {
    console.log(
      `  ✗ NEXT_PUBLIC_LIVEKIT_URL is set but doesn't start with ws:// or wss:// (got "${lkUrl}") —`
    );
    console.log(
      "    this is the #1 cause of \"invalid token\" / connection failures. Use the WebSocket URL"
    );
    console.log("    from your LiveKit project settings, not the https:// dashboard URL.");
  }
}

// --- Agent worker ---
const agentEnvPath = path.join(ROOT, "agent", ".env");
const agentEnv = parseEnvFile(agentEnvPath);
if (!agentEnv) {
  console.log(`\n✗ ${agentEnvPath} not found — copy agent/.env.example to agent/.env first.`);
  console.log("  (The agent worker won't be checked further until this exists.)");
} else {
  checkGroup("Agent worker (agent/.env) — LiveKit", agentEnv, [
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
  ]);
  checkGroup("Agent worker — Supabase (service_role)", agentEnv, [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]);
  checkGroup("Agent worker — STT", agentEnv, ["DEEPGRAM_API_KEY"]);

  const hasAnthropic = agentEnv.ANTHROPIC_API_KEY && !looksLikePlaceholder(agentEnv.ANTHROPIC_API_KEY);
  const hasOpenAI = agentEnv.OPENAI_API_KEY && !looksLikePlaceholder(agentEnv.OPENAI_API_KEY);
  console.log("\nAgent worker — LLM (at least one required)");
  console.log(`  ${hasAnthropic ? "✓" : "·"} ANTHROPIC_API_KEY`);
  console.log(`  ${hasOpenAI ? "✓" : "·"} OPENAI_API_KEY`);
  if (!hasAnthropic && !hasOpenAI) console.log("  ✗ Neither is configured — the agent cannot reason without one.");

  const hasCartesia = agentEnv.CARTESIA_API_KEY && !looksLikePlaceholder(agentEnv.CARTESIA_API_KEY);
  const hasElevenLabs = agentEnv.ELEVENLABS_API_KEY && !looksLikePlaceholder(agentEnv.ELEVENLABS_API_KEY);
  console.log("\nAgent worker — TTS (at least one required)");
  console.log(`  ${hasCartesia ? "✓" : "·"} CARTESIA_API_KEY`);
  console.log(`  ${hasElevenLabs ? "✓" : "·"} ELEVENLABS_API_KEY`);
  if (!hasCartesia && !hasElevenLabs) console.log("  ✗ Neither is configured — the agent cannot speak without one.");
}

// --- Optional live checks ---
if (LIVE) {
  console.log("\n--live checks (requires network + valid credentials)");
  if (nextEnv?.NEXT_PUBLIC_SUPABASE_URL && !looksLikePlaceholder(nextEnv.NEXT_PUBLIC_SUPABASE_URL)) {
    try {
      const res = await fetch(`${nextEnv.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
        headers: { apikey: nextEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
      });
      console.log(`  Supabase REST reachable: ${res.status < 500 ? "✓" : "✗"} (HTTP ${res.status})`);
    } catch (e) {
      console.log(`  ✗ Supabase REST unreachable: ${e.message}`);
    }
  }

  // This is THE definitive test for the "Could not establish signal
  // connection: invalid token" failure mode: it exercises the exact same
  // key/secret/URL triple the browser test page depends on, but reports a
  // clear server-side error instead of a cryptic client-side one.
  const livekitUrl = nextEnv?.NEXT_PUBLIC_LIVEKIT_URL;
  const livekitKey = nextEnv?.LIVEKIT_API_KEY;
  const livekitSecret = nextEnv?.LIVEKIT_API_SECRET;
  if (livekitUrl && livekitKey && livekitSecret && ![livekitUrl, livekitKey, livekitSecret].some(looksLikePlaceholder)) {
    try {
      const { RoomServiceClient } = await import("livekit-server-sdk");
      const httpUrl = livekitUrl.replace(/^ws/, "http"); // RoomServiceClient wants http(s), not ws(s)
      const svc = new RoomServiceClient(httpUrl, livekitKey, livekitSecret);
      const rooms = await svc.listRooms();
      console.log(`  ✓ LiveKit credentials valid — listRooms() succeeded (${rooms.length} active room(s))`);
    } catch (e) {
      if (e.code === "ERR_MODULE_NOT_FOUND" || /Cannot find module/.test(e.message)) {
        console.log("  · Skipped LiveKit live check — run `npm install` first (livekit-server-sdk not installed)");
      } else {
        console.log(`  ✗ LiveKit credentials FAILED live check: ${e.message}`);
        console.log("    This is almost certainly why the browser test shows \"invalid token\" —");
        console.log("    the key/secret don't match a real project at that URL, or one is wrong.");
      }
    }
  } else {
    console.log("  · Skipped LiveKit live check — one of URL/key/secret is missing or a placeholder");
  }
} else {
  console.log("\n(Run with --live to also check network reachability of configured services,");
  console.log(" including a real LiveKit credential round-trip — recommended if you're seeing");
  console.log(' "invalid token" on the browser voice test page.)');
}

console.log("\n================================");
console.log("A clean run means required values are SET — it does not confirm they're valid.");
console.log("Next: npm run typecheck && npm run lint && npm run build");
console.log("      cd agent && pytest");
