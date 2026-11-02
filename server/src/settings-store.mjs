import { query } from './db.mjs';

/**
 * API name (camelCase) -> column name.
 *
 * These describe the NORMAL user only. An admin session implicitly has every
 * permission: the admin password is the owner's own second key, and the owner
 * is who sets these flags, so an admin restricting itself could just undo it.
 */
export const FLAGS = {
  /** May see account balances at all — the reason the admin password exists. */
  balanceUserAccess: 'balance_user_access',
  expenseUserAccess: 'expense_user_access',
  updatePermissionUser: 'update_permission_user',
  viewPermissionUser: 'view_permission_user',
  removePermissionUser: 'remove_permission_user'
};

export const COLUMNS = Object.values(FLAGS).join(', ');

export function toApi(row) {
  const settings = {};

  for (const [name, column] of Object.entries(FLAGS)) {
    settings[name] = row[column];
  }

  return settings;
}

/** Reads the account's flags, creating the default row the first time. */
export async function loadSettings(userId) {
  const { rows } = await query(
    `insert into user_settings (user_id) values ($1)
     on conflict (user_id) do update set user_id = excluded.user_id
     returning ${COLUMNS}`,
    [userId]
  );

  return toApi(rows[0]);
}

/**
 * What the signed-in identity may actually do.
 *
 * An admin gets everything; a normal user gets whatever the flags allow.
 */
export async function effectivePermissions(session) {
  const settings = await loadSettings(session.userId);
  const admin = session.loginType === 'admin';

  return {
    settings,
    isAdmin: admin,

    /**
     * Whether any account balance may be shown. Someone signing in as a normal
     * user on a shared or public machine should not have their balances on
     * screen, so this gates the amounts themselves — in the API, in the
     * Balance Management page and in WhatsApp replies — not just the nav link.
     */
    canSeeBalances: admin || settings.balanceUserAccess,

    canUpdateBalance: admin || settings.expenseUserAccess,
    canBackdate: admin || settings.updatePermissionUser,
    canViewSource: admin || settings.viewPermissionUser,
    canRemove: admin || settings.removePermissionUser
  };
}
