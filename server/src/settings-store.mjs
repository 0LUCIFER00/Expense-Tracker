import { query } from './db.mjs';

/**
 * API name (camelCase) -> column name.
 *
 * These describe the NORMAL user only. An admin session implicitly has every
 * permission: the full-access password is the owner's own second key, and the owner
 * is who sets these flags, so an admin restricting itself could just undo it.
 */
export const FLAGS = {
  /** May see account balances at all — the reason the full-access password exists. */
  balanceUserAccess: 'balance_user_access',
  /** May reach the Add Money page; its amounts still follow the flag above. */
  addMoneyUserAccess: 'add_money_user_access',
  /** WhatsApp replies may quote a balance, when the flag above allows it too. */
  whatsappBalanceUserAccess: 'whatsapp_balance_user_access',
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
  /*
   * Read first. This runs on nearly every request, and the upsert it used to be
   * made each of those a write: a row lock and a WAL record to answer "may I
   * see this?". The row exists for every account after its first request, so
   * the insert below is the rare path.
   */
  const { rows } = await query(
    `select ${COLUMNS} from user_settings where user_id = $1`,
    [userId]
  );

  if (rows[0]) {
    return toApi(rows[0]);
  }

  const { rows: created } = await query(
    `insert into user_settings (user_id) values ($1)
     on conflict (user_id) do update set user_id = excluded.user_id
     returning ${COLUMNS}`,
    [userId]
  );

  return toApi(created[0]);
}

/**
 * The account behind a session, in one round trip: the version its sessions
 * must carry, and its permission flags.
 *
 * requireAuth calls this on every request, so the flags come along rather than
 * being fetched again by effectivePermissions.
 *
 * @returns { sessionVersion, settings } — settings is null when the account has
 *   no row yet — or null when the account no longer exists.
 */
export async function loadAccount(userId) {
  const columns = Object.values(FLAGS).map(column => `s.${column}`).join(', ');

  const { rows } = await query(
    `select u.session_version, s.user_id as has_settings, ${columns}
       from users u
       left join user_settings s on s.user_id = u.id
      where u.id = $1`,
    [userId]
  );

  if (!rows[0]) {
    return null;
  }

  return {
    sessionVersion: rows[0].session_version,
    settings: rows[0].has_settings ? toApi(rows[0]) : null
  };
}

/**
 * What an identity may do, given its account's flags.
 *
 * Pure, so the rule itself is what the tests exercise.
 */
export function permissionsFor(settings, loginType) {
  const admin = loginType === 'admin';

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

    /**
     * The Add Money page. Separate from seeing balances: someone may be
     * trusted to put money in without being shown what is already there, and
     * the amounts on that page follow canSeeBalances on their own.
     */
    canAddMoney: admin || settings.addMoneyUserAccess,

    /**
     * Whether a WhatsApp reply may quote a balance.
     *
     * Both switches have to allow it. Hiding balances is about a screen
     * someone else might see, and a phone is a screen someone else might see;
     * so the master switch still wins, and this only narrows it further.
     */
    canSeeBalancesOnWhatsapp:
      admin || (settings.balanceUserAccess && settings.whatsappBalanceUserAccess),

    canUpdateBalance: admin || settings.expenseUserAccess,
    canBackdate: admin || settings.updatePermissionUser,
    canViewSource: admin || settings.viewPermissionUser,
    canRemove: admin || settings.removePermissionUser,

    /**
     * Typing a figure into an account on Cash & Accounts, or creating or
     * deleting one. Seeing the amounts is not enough: a session barred from
     * moving money by spending must not be able to move it by retyping it.
     */
    canManageBalances:
      admin || (settings.balanceUserAccess && settings.expenseUserAccess)
  };
}

/**
 * What the signed-in identity may actually do.
 *
 * Uses the flags requireAuth already loaded with the session when they are
 * there, so a request costs one settings read rather than two.
 */
export async function effectivePermissions(session) {
  const settings = session.settings ?? await loadSettings(session.userId);

  return permissionsFor(settings, session.loginType);
}
