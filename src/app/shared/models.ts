export type LoginType = 'user' | 'admin';

/** The signed-in account, as the API reports it. Never carries credentials. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  hasAdminPassword: boolean;
  /** When the account was created; null on the leaner session responses. */
  createdAt: string | null;
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
  /** What it was spent on. Null for entries made before categories existed. */
  category: string | null;

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

  /*
   * Set only when the expense was split between people. The whole amount
   * still left the account; personalShare is the part that is the owner's own
   * spending. Optional because nothing recorded before splitting existed has
   * them, and an absent split means the whole amount was the owner's.
   */
  /** How many it was split between, the owner included. */
  splitMembers?: number | null;
  /** What each of the others owes. */
  splitShare?: number | null;
  /** The owner's own part. */
  personalShare?: number | null;
  /** Paid back so far by the others. */
  splitReceived?: number;
}

/** What the add-expense form sends. The server decides the resulting status. */
export interface NewExpense {
  amount: number;
  description: string;
  date: string;
  /** One of the server's categories, or null to leave it unfiled. */
  category: string | null;
  sourceId: string | null;
  updateBalance: boolean;
  /** Minutes behind UTC, so the server can tell what "today" means here. */
  tzOffset: number;
  /** Split between this many people, the owner included; null when it is not. */
  splitMembers?: number | null;
}

/** A split expense and how much of it has been paid back. */
export interface SplitSummary {
  id: string;
  description: string;
  date: string;
  status: 'done' | 'pending';
  amount: number;
  members: number;
  /** What each of the others owes. */
  share: number;
  /** The owner's own part. */
  personal: number;
  /** What the others owe between them. */
  owed: number;
  received: number;
  remaining: number;
  /** Who has paid back so far, oldest first. */
  repayments: SplitRepayment[];
}

export interface SplitRepayment {
  id: string;
  amount: number;
  description: string;
  date: string;
  /** The account it went into. */
  account: string | null;
}

/**
 * What a NORMAL user may do. An admin session always has everything — the
 * full-access password is the owner's own second key, so restricting it is pointless.
 */
export interface Settings {
  /** May see account balances at all. The reason the full-access password exists. */
  balanceUserAccess: boolean;
  /** May reach the Add Money page; its amounts still follow the flag above. */
  addMoneyUserAccess: boolean;
  /** WhatsApp replies may quote a balance, when the flag above allows it too. */
  whatsappBalanceUserAccess: boolean;
  expenseUserAccess: boolean;
  updatePermissionUser: boolean;
  viewPermissionUser: boolean;
  removePermissionUser: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  balanceUserAccess: true,
  addMoneyUserAccess: true,
  whatsappBalanceUserAccess: true,
  expenseUserAccess: true,
  updatePermissionUser: true,
  viewPermissionUser: true,
  removePermissionUser: true
};

/** Money coming in: the mirror of an Expense. */
export interface Income {
  id: string;
  amount: number;
  description: string;
  date: string;
  /** Where it came from, or null when it was filed without a category. */
  category: string | null;

  /** The account it went into. Null when this session may not see sources. */
  targetId: string | null;
  targetType: string | null;
  targetCategory: string | null;

  balanceUpdated: boolean;
  createdAt: string;

  /** Set when this was someone paying back their part of a split expense. */
  splitExpenseId?: string | null;
  splitDescription?: string | null;
}

/** What the Add Money form sends. */
export interface NewIncome {
  amount: number;
  description: string;
  date: string;
  category: string | null;
  /** Required: money has to arrive somewhere, or the balances go wrong. */
  targetId: string;
  /** The split expense this pays back part of, when it does. */
  splitExpenseId?: string | null;
}
