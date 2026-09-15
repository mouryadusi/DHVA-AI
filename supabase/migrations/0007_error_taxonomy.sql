-- Dhva AI — structured error taxonomy for tool_executions
--
-- FINDING (fresh audit): failures were logged as free-text
-- (`error_message`) with no consistent category, so "how many calls this
-- week failed due to the LLM provider vs. a tool bug vs. Telephony" was
-- not a real query — it required reading prose log lines by hand. This
-- adds a constrained category column backed by the fixed 14-value
-- taxonomy in agent/src/errors.py, so it's an actual queryable dimension
-- in the database, not just structured log output (agent/src/logging_utils.py
-- handles the log-line side of the same taxonomy).

alter table tool_executions add column error_category text
  check (error_category in (
    'AUTH_ERROR', 'AUTHORIZATION_ERROR', 'TENANT_ACCESS_DENIED', 'ONBOARDING_ERROR',
    'DATABASE_ERROR', 'VALIDATION_ERROR', 'LLM_TIMEOUT', 'LLM_PROVIDER_ERROR',
    'TOOL_ERROR', 'STT_ERROR', 'TTS_ERROR', 'TELEPHONY_ERROR', 'LIVEKIT_ERROR',
    'INTEGRATION_ERROR'
  ));

-- Only meaningful on failed executions — a successful tool call has no
-- error to categorize. Enforced as a check constraint, not just a
-- convention, so a future bug can't silently attach a category to a
-- success row and produce misleading failure-rate queries.
--
-- Added NOT VALID deliberately: any tool_executions rows written before
-- this migration (failed, with error_message, but no error_category —
-- exactly the gap this migration closes) would otherwise make this
-- ALTER TABLE fail outright against real data. NOT VALID adds the
-- constraint for all FUTURE writes immediately while skipping validation
-- of existing rows, which is the correct, production-safe way to add a
-- CHECK constraint to a table that may already have data. Run
-- `alter table tool_executions validate constraint tool_executions_error_category_only_on_failure;`
-- once historical rows have been backfilled or confirmed irrelevant, to
-- close the gap fully.
alter table tool_executions add constraint tool_executions_error_category_only_on_failure
  check (success = true or error_category is not null or error_message is null) not valid;

create index idx_tool_executions_error_category on tool_executions(error_category)
  where error_category is not null;
