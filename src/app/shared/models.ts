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
  balance: number;
  saved: boolean;
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

export interface Settings {
  balanceUserAccess: boolean;
  balanceAdminAccess: boolean;
  expenseUserAccess: boolean;
  expenseAdminAccess: boolean;
  updatePermissionUser: boolean;
  updatePermissionAdmin: boolean;
  viewPermissionUser: boolean;
  viewPermissionAdmin: boolean;
  removePermissionUser: boolean;
  removePermissionAdmin: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  balanceUserAccess: true,
  balanceAdminAccess: true,
  expenseUserAccess: true,
  expenseAdminAccess: true,
  updatePermissionUser: true,
  updatePermissionAdmin: true,
  viewPermissionUser: true,
  viewPermissionAdmin: true,
  removePermissionUser: true,
  removePermissionAdmin: true
};
