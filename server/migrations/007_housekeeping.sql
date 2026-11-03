-- Two things the pre-deployment audit turned up.
--
-- 1. WhatsApp's "undo" looks for the most recent entry that arrived over that
--    channel. incomes has an index for exactly that query; expenses never got
--    the matching one, so the same lookup falls back to a scan of every
--    expense the account has ever recorded.
--
-- 2. whatsapp_processed_messages exists to recognise a retried delivery. Meta
--    retries within minutes, so a row is useful for hours and then never
--    again — but nothing ever removed one, and the table only grew. The index
--    on processed_at lets the prune find old rows without a scan.

create index if not exists expenses_user_channel_idx
  on expenses (user_id, source_channel, created_at desc);

create index if not exists whatsapp_processed_messages_processed_at_idx
  on whatsapp_processed_messages (processed_at);
