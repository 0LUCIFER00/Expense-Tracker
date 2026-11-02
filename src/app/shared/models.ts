export type LoginType = 'user' | 'admin';

/** The signed-in account, as the API reports it. Never carries credentials. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  hasAdminPassword: boolean;
}

export interface Session {
  user: SessionUser;
  loginType: LoginType;
}

export interface BalanceAccount {
  id: string;
  type: string;
  category: string;
  /** Null when the amount is withheld — see `hidden`. */
  balance: number | null;
  saved: boolean;
  /** True when the server withheld the amount rather than it being unknown. */
  hidden: boolean;
}

export type ExpenseStatus = 'Done' | 'Pending / Waiting Admin';

export interface Expense {
  id: string;
  amount: number;
  description: string;
  date: string;

  sourceId: string | null;
  sourceType: string | null;
  sourceCategory: string | null;

  expenseAccess: boolean;
  updatePermission: boolean;
  balanceUpdated: boolean;

  status: ExpenseStatus;
  remarks: string | null;
  isPendingApproval: boolean;
  createdAt: string;
}

/** What the add-expense form sends. The server decides the resulting status. */
export interface NewExpense {
  amount: number;
  description: string;
  date: string;
  sourceId: string | null;
  updateBalance: boolean;
  /** Minutes behind UTC, so the server can tell what "today" means here. */
  tzOffset: number;
}

/**
 * What a NORMAL user may do. An admin session always has everything — the
 * admin password is the owner's own second key, so restricting it is pointless.
 */
export interface Settings {
  /** May see account balances at all. The reason the admin password exists. */
  balanceUserAccess: boolean;
  expenseUserAccess: boolean;
  updatePermissionUser: boolean;
  viewPermissionUser: boolean;
  removePermissionUser: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  balanceUserAccess: true,
  expenseUserAccess: true,
  updatePermissionUser: true,
  viewPermissionUser: true,
  removePermissionUser: true
};
