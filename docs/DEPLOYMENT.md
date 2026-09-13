# Deployment

Two separate deployables. Don't try to put both on Vercel — see "Why this
isn't part of the Next.js app" in `agent/README.md`.

## 1. Next.js dashboard → Vercel

```bash
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY      # only if any server route ends up needing it
vercel env add LIVEKIT_API_KEY
vercel env add LIVEKIT_API_SECRET
vercel env add NEXT_PUBLIC_LIVEKIT_URL
vercel deploy --prod
```

Standard Next.js App Router deploy — no special configuration needed.
Confirm build passes locally first (`npm run build`) since this sandbox
couldn't verify it due to disabled network access (see README "Known
limitations").

## 2. Agent worker → Railway / Fly.io / Render (not Vercel)

Any platform that runs a persistent process works. Example using a
generic Dockerfile-based deploy (Railway, Fly.io, Render all support this
pattern):

`agent/Dockerfile`:
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "-m", "src.entrypoint", "start"]
```

Set the same environment variables as `agent/.env.example` in your
platform's secret manager — never commit them.

Scale by running multiple instances; LiveKit balances job dispatch across
all workers connected to your project. Watch concurrent-call capacity per
instance (STT/LLM/TTS streaming connections are the limiting resource, not
CPU) and add instances before you hit it, not after.

## 3. Supabase

```bash
supabase link --project-ref <your-project-ref>
npm run db:migrate   # applies supabase/migrations/*.sql
npm run db:seed      # loads the Dhva Pizza demo tenant
```

## 4. LiveKit

Use LiveKit Cloud (simplest) or self-host. Either way you need the
project's URL/API key/secret in both the Next.js app's env and the agent
worker's env (they point at the same LiveKit project, not separate ones).

## Order of operations for a first production deploy

1. Supabase: migrate + seed
2. Deploy agent worker, confirm it connects to LiveKit (check worker logs)
3. Deploy Next.js app to Vercel
4. Sign up through the deployed app, confirm you land on the dashboard
5. Test via `/test` (browser) before touching real telephony
6. Only then follow `docs/TELNYX_SETUP.md` for the real phone number
