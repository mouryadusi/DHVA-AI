"""
Thin Supabase client wrapper for the agent worker.

This runs server-side with the service_role key on purpose — the agent
worker is a trusted backend process that must read/write across every
tenant's calls, not a browser client. RLS (supabase/migrations/0002_rls.sql)
protects the *dashboard*'s browser-facing anon-key access; it does not
apply here and isn't meant to.
"""
from __future__ import annotations

import os
from functools import lru_cache

from supabase import create_client, Client


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)
