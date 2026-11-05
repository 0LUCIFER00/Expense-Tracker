-- Lets a session be revoked.
--
-- The session is a signed cookie with nothing stored on the server, so until
-- now a cookie stayed valid for its full seven days whatever happened to the
-- account: a password change, a new or removed full-access password. That
-- matters most for the full-access password, which exists to protect a shared
-- machine — changing it after it leaked did not sign anybody out.
--
-- Every cookie now carries the version current when it was issued, and every
-- request compares it with this column. Raising the column signs out every
-- cookie issued before; the device that made the change is issued a new one.
--
-- Additive: existing rows get 0, and cookies issued before this column existed
-- carry no version, which is read as 0 — so nobody is signed out by deploying.

alter table users
  add column if not exists session_version integer not null default 0;

comment on column users.session_version is
  'Raised to revoke every session issued before; compared with the ver claim in the cookie';
