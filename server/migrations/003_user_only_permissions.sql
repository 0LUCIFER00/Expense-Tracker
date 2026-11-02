-- The permission matrix had a column per flag for the admin identity as well as
-- the user, but restricting the admin never made sense: the admin password is
-- the owner's own second key, and the owner is who sets the flags. Only the
-- admin can change them, so an admin restricting itself could simply undo it.
--
-- An admin now implicitly has every permission, and the stored flags describe
-- the normal user alone.

alter table user_settings drop column if exists balance_admin_access;
alter table user_settings drop column if exists expense_admin_access;
alter table user_settings drop column if exists update_permission_admin;
alter table user_settings drop column if exists view_permission_admin;
alter table user_settings drop column if exists remove_permission_admin;

-- balance_user_access used to mean only "show the Balance Management link".
-- It now means "may see balances at all", which is the point of the admin
-- password: signing in as a normal user in public should not put account
-- balances on screen. Enforced in the API, not only in the UI.
comment on column user_settings.balance_user_access is
  'Normal user may see account balances (nav link, amounts, WhatsApp)';
