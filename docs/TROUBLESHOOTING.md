# Troubleshooting

## "No business found for your organization" / "No organization found for your account"

**Actual root cause, found by tracing the full chain (not the first
hypothesis):** the client-side signup flow inserted into `organizations`
immediately after `supabase.auth.signUp()`. If the Supabase project
requires email confirmation (Supabase's own default for new projects),
`signUp()` returns a user but **no active session** — `auth.uid()` is
null client-side until the user actually confirms and logs in. The
`organizations` INSERT policy correctly requires `auth.uid() is not
null`, so the insert was silently rejected. The user then confirms,
logs in with a real session, and lands on a dashboard for an account that
was never given an organization at all.

This was a second, deeper layer under the first fix (the missing INSERT
policies) — fixing the policies alone wasn't sufficient, because the
client-side insert timing was itself broken.

**Fix (`supabase/migrations/0004_fix_signup_trigger.sql`):** provisioning
moved to a trigger on `auth.users` itself, which fires the instant
Postgres creates the user row — regardless of email-confirmation status
or client session state. This is the same pattern Supabase's own docs use
for auto-creating profile rows on signup. `app/signup/page.tsx` no longer
does any organization/business creation itself.

**If you still see this message:**

1. Confirm `0004_fix_signup_trigger.sql` applied:
   ```sql
   select tgname from pg_trigger where tgname = 'on_auth_user_created';
   ```
2. If you signed up **before** this migration existed, the one-time
   backfill in that same migration should have already fixed your
   account — check:
   ```sql
   select * from org_members where user_id = auth.uid();
   ```
   If that's empty, something failed silently during the backfill (check
   Postgres logs for `raise warning 'handle_new_user failed...'`) — the
   dashboard's **"Create starter business now"** button still works as a
   manual recovery path if you have an org but no business; if you have
   neither, you'll need to manually insert an `org_members` row for
   yourself and then use that button.
3. Check Postgres logs for `raise warning` output from `handle_new_user`
   — provisioning failures are logged, not silently swallowed, by design.

## Browser voice test: "Could not establish signal connection: invalid token"

This error means the token **reached LiveKit's server and was rejected**
— it is almost never a bug in how the token is built. The token-minting
code (`lib/livekit/token.ts`) matches the current `livekit-server-sdk` v2
API exactly (`new AccessToken(...)` → `.addGrant(...)` → `await
.toJwt()`), confirmed against current docs during this fix.

**Actual causes, in order of likelihood:**

1. **`NEXT_PUBLIC_LIVEKIT_URL` is the wrong scheme.** The single most
   common mistake: pasting the LiveKit Cloud dashboard's `https://`
   project URL instead of the `wss://` WebSocket URL shown right next to
   it. `npm run doctor` now checks this specifically and will tell you
   directly if it's wrong.
2. **`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` don't match the project at
   that URL** — e.g. copied from a different LiveKit project, or one of
   the pair is stale after rotating keys. `npm run doctor -- --live` now
   does a real round-trip (`RoomServiceClient.listRooms()`) against your
   actual LiveKit project using these exact credentials — this is the
   definitive test, since it exercises precisely the failure mode you're
   hitting but reports a clear server-side error instead of a cryptic
   client-side one.
3. **Placeholder values were never replaced.** `lib/livekit/token.ts` now
   detects obviously-placeholder-looking values (`your-...`, `xxx...`,
   `changeme`, empty) and fails with a clear error instead of silently
   minting a token from garbage that fails mysteriously in the browser.

**Fix workflow:**
```bash
npm run doctor -- --live
```
Read its output — it will tell you specifically which of the three above
is wrong, rather than leaving you to guess from the browser's generic
WebSocket error.

## Agent worker won't connect to LiveKit

- Check `agent/.env` has `LIVEKIT_URL` (not the dashboard URL — the
  project's WebSocket URL, `wss://...`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- Run `npm run doctor` from the repo root — it checks these are present
  (not that they're valid; an invalid key still passes doctor and fails
  at connect time)
- Check the worker's own logs when you run `python -m src.entrypoint dev`
  — a bad API key/secret fails fast with an auth error at startup

## Call connects but agent is silent / never greets

Most likely causes, in order of likelihood:
1. STT/LLM/TTS provider key is invalid or rate-limited — check agent
   worker logs; `entrypoint.py`'s except block should have caught this
   and attempted a spoken fallback ("I'm having trouble connecting…") — if
   you got dead air instead, the TTS call in the fallback path itself also
   failed, meaning the TTS provider is fully down/misconfigured
2. `resolve_business_id_for_room` couldn't find a business — check for a
   `BusinessBrainNotFound` exception in the worker logs; means either no
   business exists yet (see above) or (for a real SIP call) the dialed
   number isn't in `phone_numbers` with `status = 'active'`

## Browser test page: "Failed to get a room token" / 401

- You must be logged into the dashboard first — `/api/livekit/token`
  requires an authenticated Supabase session
- Check `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` are set in `.env.local`
  (not just `agent/.env` — the Next.js app mints its own tokens
  separately, see `CLAUDE.md`'s two-process architecture section)

## Browser test page: connects but no transcript appears

- Confirm the agent worker is actually running and connected (its logs
  should show a job dispatch when you click "Start call")
- `RoomEvent.TranscriptionReceived` is what populates the transcript —
  this depends on LiveKit's transcription forwarding being active for the
  STT plugin in use; if this event never fires, check the LiveKit Agents
  version pinned in `agent/requirements.txt` against current
  https://docs.livekit.io/agents/ for any transcription-forwarding
  configuration change

## Human transfer doesn't work

See `docs/PHONE_TEST.md` Test 3 — `execute_transfer`'s SIP transfer method
is explicitly flagged **IMPLEMENTED BUT NOT VERIFIED**. Check agent worker
logs for the specific exception; it's very likely a method/argument name
mismatch against the installed `livekit-agents` version, not a logic bug.

## RLS blocks a query you think should work

- Every business-scoped table requires the current user to be a member of
  the org that owns the business (`is_business_member()` /
  `is_org_member()` helper functions in `0002_rls.sql`) — confirm with:
  ```sql
  select * from org_members where user_id = auth.uid();
  ```
  run as that user (via the Supabase dashboard's "Run as user" / JWT
  impersonation, not as the postgres superuser, which bypasses RLS
  entirely and will hide the problem)
- `tests/tenant-isolation.test.ts` only checks that a policy *exists* per
  table, not that its logic is correct — a subtly wrong `USING` clause
  will pass that test and still leak/block data. Test with real user
  sessions, not just the static check.

## `npm run build` / `pytest` fail

This codebase was written without network access to actually run these —
see the warning at the top of `README.md`. If you hit an error here,
it's genuinely useful information this build process couldn't surface;
please don't assume it "should just work" because a prior response said
tests were written — written and passing are different claims, and this
repo's own docs are explicit about which is which.
