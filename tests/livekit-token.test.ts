import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mintTestToken } from "@/lib/livekit/token";

// AccessToken.toJwt() signs locally with jose — no network call — so this
// is a real, fully offline-testable unit test, not one that needs mocking
// around a live LiveKit project.

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("mintTestToken", () => {
  it("throws a clear error when credentials are entirely missing", async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    await expect(mintTestToken({ roomName: "r", participantIdentity: "p" })).rejects.toThrow(
      /not set/i
    );
  });

  it("throws a clear error when credentials look like placeholders", async () => {
    process.env.LIVEKIT_API_KEY = "your-livekit-api-key";
    process.env.LIVEKIT_API_SECRET = "your-livekit-api-secret";
    await expect(mintTestToken({ roomName: "r", participantIdentity: "p" })).rejects.toThrow(
      /placeholder/i
    );
  });

  it("mints a well-formed JWT when credentials look real", async () => {
    process.env.LIVEKIT_API_KEY = "APIkey1234567890";
    process.env.LIVEKIT_API_SECRET = "supersecretvalue1234567890";
    const token = await mintTestToken({ roomName: "test-room", participantIdentity: "user-1" });
    // A JWT is three base64url segments separated by dots — this confirms
    // toJwt() actually produced a real signed token, not an error object
    // silently stringified.
    expect(token.split(".")).toHaveLength(3);
  });
});
