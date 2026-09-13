import { AccessToken } from "livekit-server-sdk";

/**
 * Mints a LiveKit room access token for the browser voice test page.
 *
 * The browser joins the same kind of LiveKit room a phone caller would be
 * placed into via SIP dispatch — the agent worker (agent/src/entrypoint.py)
 * doesn't know or care whether the other participant arrived over WebRTC
 * (browser) or SIP (phone call). This is what makes /test a REAL test of
 * the voice pipeline, not a mock.
 *
 * IMPORTANT about "Could not establish signal connection: invalid token":
 * this error means the token reached LiveKit's server and was REJECTED —
 * it is almost never a bug in how the token is built (the shape here
 * matches the current livekit-server-sdk v2 API exactly: constructor ->
 * addGrant -> `await toJwt()`). It means the api key/secret used to sign
 * this token don't match a real key pair on the LiveKit project at
 * NEXT_PUBLIC_LIVEKIT_URL — most commonly because one of the three values
 * (LIVEKIT_API_KEY, LIVEKIT_API_SECRET, NEXT_PUBLIC_LIVEKIT_URL) is still
 * a placeholder, or the key/secret are from a different LiveKit project
 * than the URL. `npm run doctor -- --live` checks this exact failure mode
 * server-side with a clear error, instead of leaving it to surface as a
 * cryptic client-side WebSocket error — run that first.
 */

const PLACEHOLDER_PATTERNS = [/^$/, /your[-_]?/i, /^xxx/i, /^changeme/i, /^<.*>$/];

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(value.trim()));
}

export async function mintTestToken(params: {
  roomName: string;
  participantIdentity: string;
}): Promise<string> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      "LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set. Copy .env.example to .env.local and fill them in, then restart the dev server."
    );
  }
  if (looksLikePlaceholder(apiKey) || looksLikePlaceholder(apiSecret)) {
    throw new Error(
      "LIVEKIT_API_KEY / LIVEKIT_API_SECRET look like placeholder values, not real credentials from your LiveKit project. " +
        "Run `npm run doctor` to confirm, then check the LiveKit Cloud dashboard → Settings → Keys."
    );
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: params.participantIdentity,
    ttl: "15m",
  });

  at.addGrant({
    room: params.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return await at.toJwt();
}
