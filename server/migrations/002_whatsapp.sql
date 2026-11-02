-- Lets a user add an expense by sending a WhatsApp message, without logging in.
--
-- A number is bound to one account through a short-lived one-time code that the
-- user sends from the handset they want to link, which proves they control it.

alter table users
  add column if not exists whatsapp_number text;

-- One handset maps to at most one account, so an inbound message is never
-- ambiguous about whose expense it is.
create unique index if not exists users_whatsapp_number_idx
  on users (whatsapp_number)
  where whatsapp_number is not null;

create table if not exists whatsapp_link_codes (
  code       text primary key,
  user_id    uuid        not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_link_codes_user_idx
  on whatsapp_link_codes (user_id);

-- Where an entry came from, so the UI can mark it and "undo" can find the last
-- one that arrived over WhatsApp.
alter table expenses
  add column if not exists source_channel text not null default 'web';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'expenses_source_channel_check'
  ) then
    alter table expenses
      add constraint expenses_source_channel_check
      check (source_channel in ('web', 'whatsapp'));
  end if;
end
$$;

-- Guards against a retried Meta webhook inserting the same expense twice.
-- Meta re-delivers on any non-2xx, and message ids are stable across retries.
create table if not exists whatsapp_processed_messages (
  message_id   text primary key,
  processed_at timestamptz not null default now()
);
