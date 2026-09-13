import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mintTestToken } from "@/lib/livekit/token";

function validateLiveKitUrl(url: string | undefined): string {
  if (!url) {
    throw new Error("NEXT_PUBLIC_LIVEKIT_URL is not set in .env.local.");
  }
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    // The single most common real-world misconfiguration: pasting the
    // LiveKit Cloud dashboard's https:// project URL instead of the
    // wss:// WebSocket URL shown right next to it.
    throw new Error(
      `NEXT_PUBLIC_LIVEKIT_URL must start with ws:// or wss:// (got "${url}"). ` +
        "Use the WebSocket URL from your LiveKit project settings, not the https:// dashboard URL."
    );
  }
  return url;
}

export async function POST() {
  // Require auth — this is a real room token, not a public demo.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Rate limit: at most 10 room tokens per user per minute. Implemented as
  // an atomic SECURITY DEFINER RPC (supabase/migrations/0005_review_and_rate_limit.sql)
  // rather than a check-then-insert from here, to avoid a race between the
  // check and the record under concurrent requests.
  const { data: allowed, error: rateLimitError } = await supabase.rpc("check_and_record_token_mint");
  if (rateLimitError) {
    console.error("[api/livekit/token] rate limit check failed:", rateLimitError.message);
    // Fail open on an infra error (missing migration, etc.) rather than
    // blocking every browser test session — but log loudly so it's caught.
  } else if (allowed === false) {
    return NextResponse.json(
      { error: "Too many connection attempts — wait a minute and try again." },
      { status: 429 }
    );
  }

  const roomName = `browser-test-${randomUUID()}`;
  const participantIdentity = `browser-${user.id.slice(0, 8)}`;

  try {
    const livekitUrl = validateLiveKitUrl(process.env.NEXT_PUBLIC_LIVEKIT_URL);
    const token = await mintTestToken({ roomName, participantIdentity });
    return NextResponse.json({ token, roomName, livekitUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to mint token";
    console.error("[api/livekit/token]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
