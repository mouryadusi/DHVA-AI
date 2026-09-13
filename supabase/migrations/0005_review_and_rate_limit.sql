-- Dhva AI — needs_review flagging + token-mint rate limiting
--
-- Part 1: `calls.needs_review` — see docs/COMPETITIVE_ANALYSIS.md finding
-- #4. Every reviewed competitor captures a transcript when the agent
-- struggles; none surface WHICH calls need the owner's attention. This is
-- a real, narrow, buildable differentiator: flag calls where the agent
-- hit genuine uncertainty (empty search results, a failed order
-- calculation, a failed transfer, or an explicit escalation reason
-- indicating confusion) so the dashboard can show "N calls need review"
-- instead of the owner having to read every transcript.

alter table calls add column needs_review boolean not null default false;
alter table calls add column review_reason text;

create index idx_calls_needs_review on calls(business_id, needs_review) where needs_review;

-- Part 2: rate limiting for LiveKit token minting
-- (docs/README.md's "Security & production-readiness review" previously
-- flagged this as a real, unaddressed gap: /api/livekit/token had no
-- rate limit beyond requiring auth, so a logged-in user could mint
-- unlimited rooms.)
--
-- Implemented as a SECURITY DEFINER function rather than a new
-- RLS-protected table with policies, because the access pattern (atomic
-- check-and-record, called from a Route Handler using the user's own
-- session) is simpler and harder to get subtly wrong as a single function
-- than as insert+select policies with a race condition between them.

create table token_mint_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index idx_token_mint_events_user_time on token_mint_events(user_id, created_at desc);

alter table token_mint_events enable row level security;
-- No client-facing policies at all — this table is only ever touched
-- through the SECURITY DEFINER function below, by design (defense in
-- depth: even a bug elsewhere can't let a client read or forge rows here).

create or replace function check_and_record_token_mint(p_max_per_minute int default 10)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recent_count int;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select count(*) into v_recent_count
  from token_mint_events
  where user_id = v_user_id and created_at > now() - interval '1 minute';

  if v_recent_count >= p_max_per_minute then
    return false;
  end if;

  insert into token_mint_events (user_id) values (v_user_id);
  return true;
end;
$$;

grant execute on function check_and_record_token_mint(int) to authenticated;

-- Housekeeping: old rows are only ever needed for a 1-minute lookback —
-- keep the table small. Run manually or wire to pg_cron if available;
-- not required for correctness, only for table bloat over a long-running
-- deployment.
comment on table token_mint_events is
  'Rolling rate-limit log for /api/livekit/token. Safe to delete rows older than a few minutes at any time.';
