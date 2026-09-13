"use client";

import { useCallback, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type RemoteParticipant,
  type TranscriptionSegment,
} from "livekit-client";

type ConnectionState = "idle" | "connecting" | "connected" | "error";

interface TranscriptLine {
  id: string;
  speaker: "you" | "dhva";
  text: string;
  final: boolean;
}

/**
 * Real voice test: browser mic -> LiveKit room -> the same AgentSession
 * (agent/src/entrypoint.py) a phone caller would talk to. Nothing here is
 * pre-scripted; the transcript below comes from LiveKit's transcription
 * events, which mirror what the agent's STT/LLM/TTS pipeline actually
 * produced during the call.
 */
export default function VoiceTestPage() {
  const [state, setState] = useState<ConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [micActive, setMicActive] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [connectMs, setConnectMs] = useState<number | null>(null);

  const roomRef = useRef<Room | null>(null);

  const connect = useCallback(async () => {
    setState("connecting");
    setError(null);
    setTranscript([]);
    const t0 = performance.now();

    try {
      const res = await fetch("/api/livekit/token", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) {
          throw new Error(body.error ?? "Too many attempts — wait a minute and try again.");
        }
        throw new Error(body.error ?? "Failed to get a room token");
      }
      const { token, livekitUrl } = await res.json();
      if (!livekitUrl) {
        throw new Error("NEXT_PUBLIC_LIVEKIT_URL is not configured");
      }

      const room = new Room();
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant: RemoteParticipant) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.style.display = "none";
          document.body.appendChild(el);
        }
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setAgentSpeaking(speakers.some((s) => !s.isLocal));
      });

      // LiveKit streams STT transcriptions (both caller and agent) as
      // transcription segments over the room — this is real pipeline
      // output, not something this page fabricates.
      room.on(
        RoomEvent.TranscriptionReceived,
        (segments: TranscriptionSegment[], participant?: RemoteParticipant) => {
          setTranscript((prev) => {
            const speaker: "you" | "dhva" = participant ? "dhva" : "you";
            const next = [...prev];
            for (const seg of segments) {
              const idx = next.findIndex((l) => l.id === seg.id);
              const line: TranscriptLine = {
                id: seg.id,
                speaker,
                text: seg.text,
                final: seg.final,
              };
              if (idx >= 0) next[idx] = line;
              else next.push(line);
            }
            return next;
          });
        }
      );

      room.on(RoomEvent.Disconnected, () => {
        setState("idle");
        setMicActive(false);
      });

      await room.connect(livekitUrl, token);
      setConnectMs(Math.round(performance.now() - t0));

      const micTrack = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true });
      await room.localParticipant.publishTrack(micTrack);
      setMicActive(true);
      setState("connected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setState("error");
    }
  }, []);

  const disconnect = useCallback(async () => {
    await roomRef.current?.disconnect();
    roomRef.current = null;
    setState("idle");
    setMicActive(false);
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="mb-1 text-xl font-semibold">Browser voice test</h1>
      <p className="mb-6 text-sm text-ink-400">
        Talk to the live agent through your microphone. This connects to the same LiveKit room type
        a real phone call is routed into — see agent/src/entrypoint.py.
      </p>

      <div className="mb-6 flex items-center gap-3">
        {state !== "connected" ? (
          <button
            onClick={connect}
            disabled={state === "connecting"}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
          >
            {state === "connecting" ? "Connecting…" : "Start call"}
          </button>
        ) : (
          <button
            onClick={disconnect}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            End call
          </button>
        )}

        <span
          className={`h-2 w-2 rounded-full ${
            state === "connected" ? "bg-emerald-400" : state === "error" ? "bg-red-400" : "bg-ink-600"
          }`}
        />
        <span className="text-sm text-ink-400">
          Mic: {micActive ? "live" : "off"} · Agent: {agentSpeaking ? "speaking" : "listening"}
          {connectMs !== null && ` · connect: ${connectMs}ms`}
        </span>
      </div>

      {error && (
        <div className="mb-6 rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          {error}
          {error.includes("LIVEKIT") && (
            <p className="mt-1 text-red-400">
              Check LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET / NEXT_PUBLIC_LIVEKIT_URL in
              .env.local, and confirm the agent worker (agent/) is running and connected.
            </p>
          )}
        </div>
      )}

      <div className="min-h-[300px] rounded-lg border border-ink-800 bg-ink-900 p-4">
        {transcript.length === 0 ? (
          <p className="text-sm text-ink-400">
            Transcript will appear here once the call connects and you start speaking.
          </p>
        ) : (
          <div className="space-y-2">
            {transcript.map((line) => (
              <p key={line.id} className="text-sm">
                <span className={line.speaker === "you" ? "text-accent-500" : "text-ink-50"}>
                  {line.speaker === "you" ? "You" : "Dhva"}:
                </span>{" "}
                <span className={line.final ? "text-ink-200" : "text-ink-400 italic"}>{line.text}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
