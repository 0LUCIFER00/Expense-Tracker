import { query } from './db.mjs';

/** API name (camelCase) -> column name. */
export const FLAGS = {
  balanceUserAccess: 'balance_user_access',
  balanceAdminAccess: 'balance_admin_access',
  expenseUserAccess: 'expense_user_access',
  expenseAdminAccess: 'expense_admin_access',
  updatePermissionUser: 'update_permission_user',
  updatePermissionAdmin: 'update_permission_admin',
  viewPermissionUser: 'view_permission_user',
  viewPermissionAdmin: 'view_permission_admin',
  removePermissionUser: 'remove_permission_user',
  removePermissionAdmin: 'remove_permission_admin'
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
 * Collapses the ten flags down to what the signed-in identity may actually do.
 * The admin column applies when the session was opened with the admin password.
 */
export async function effectivePermissions(session) {
  const settings = await loadSettings(session.userId);
  const admin = session.loginType === 'admin';

  return {
    settings,
    canUpdateBalance: admin ? settings.expenseAdminAccess : settings.expenseUserAccess,
    canBackdate: admin ? settings.updatePermissionAdmin : settings.updatePermissionUser,
    canViewSource: admin ? settings.viewPermissionAdmin : settings.viewPermissionUser,
    canRemove: admin ? settings.removePermissionAdmin : settings.removePermissionUser
  };
}
