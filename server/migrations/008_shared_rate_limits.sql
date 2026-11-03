-- The rate limiter counted attempts in a Map inside the process.
--
-- That is correct for one long-lived server and wrong everywhere else. On a
-- serverless platform the app runs as several instances that are created and
-- discarded around traffic, so each keeps its own count and the whole window
-- resets whenever an instance is recycled. Ten attempts per ten minutes then
-- means ten per instance, which is not a limit anyone can rely on — and the
-- endpoints it guards are the ones that take a password.
--
-- A row per bucket puts the count somewhere every instance can see. The write
-- costs a round trip, but only on the handful of endpoints that accept a
-- password, never on the ordinary read paths.
--
-- id is "METHOD /path|key" — the method and path of the endpoint, then
-- whatever that limiter counts against (an address, or an account).

create table if not exists rate_limit_buckets (
  id text primary key,
  count integer not null,
  reset_at timestamptz not null
);

-- Expired buckets are deleted in passing; this keeps that from scanning.
create index if not exists rate_limit_buckets_reset_at_idx
  on rate_limit_buckets (reset_at);
