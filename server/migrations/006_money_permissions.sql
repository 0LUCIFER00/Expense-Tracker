-- Two more things a normal user may or may not do.
--
-- Both sit under "see account balances", because both are ways of reaching a
-- balance: one through a page, the other through a phone. Neither can override
-- that switch — it stays the master — but each can be turned off on its own
-- while balances are otherwise visible.

alter table user_settings
  add column if not exists add_money_user_access boolean not null default true;

alter table user_settings
  add column if not exists whatsapp_balance_user_access boolean not null default true;

comment on column user_settings.add_money_user_access is
  'Normal user sees the Add Money page; the amounts on it still follow balance_user_access';

comment on column user_settings.whatsapp_balance_user_access is
  'WhatsApp replies may quote a balance; only ever when balance_user_access allows it too';
