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
  /** Only on the answer to adding or approving one: budget thresholds it crossed. */
  budgetAlerts?: BudgetAlert[];
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
  /** May create, change and remove budgets; seeing them needs nothing. */
  budgetUserAccess: boolean;
  /** Add a budget alert line to WhatsApp replies. A preference, off by default. */
  whatsappBudgetAlerts: boolean;
  /** May create, change, pause and delete recurring schedules; seeing them needs nothing. */
  recurringUserAccess: boolean;
  /** Add recurring reminder lines to WhatsApp replies. A preference, off by default. */
  whatsappRecurringReminders: boolean;
}

/**
 * The shortest password accepted when one is set or changed, matching the API.
 * Signing in still accepts the shorter ones set before this was raised.
 */
export const PASSWORD_MIN = 8;

export const DEFAULT_SETTINGS: Settings = {
  balanceUserAccess: true,
  addMoneyUserAccess: true,
  whatsappBalanceUserAccess: true,
  expenseUserAccess: true,
  updatePermissionUser: true,
  viewPermissionUser: true,
  removePermissionUser: true,
  budgetUserAccess: true,
  whatsappBudgetAlerts: false,
  recurringUserAccess: true,
  whatsappRecurringReminders: false
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
  /** The browser's UTC offset, so the server knows what "today" is here. */
  tzOffset: number;
}

// ----------------------------------------------------------------- budgets

/** Green under 70%, orange from 70%, red at 100% and over. */
export type BudgetStatus = 'on-track' | 'near' | 'over';

/** One category's budget for a month, worked out by the API. */
export interface BudgetLine {
  category: string;
  budget: number;
  spent: number;
  /** Negative when over. */
  remaining: number;
  percent: number;
  status: BudgetStatus;
}

/** A threshold already announced this month. 101 stands for "over". */
export interface BudgetAlertRecord {
  scope: string;
  threshold: number;
  spent: number;
  at: string;
}

/** A month as the Budgets page and Home show it. All figures from the API. */
export interface BudgetMonth {
  month: string;
  exists: boolean;
  /** The overall limit, when one is set. */
  overall: number | null;
  /** No overall limit: the category limits together stand for the month. */
  fromCategories: boolean;
  total: number | null;
  spent: number;
  remaining: number | null;
  percent: number | null;
  status: BudgetStatus | null;
  allocated: number;
  overCount: number;
  categories: BudgetLine[];
  unbudgeted: { category: string; spent: number }[];
  alerts: BudgetAlertRecord[];
  canManage: boolean;
}

/** What the edit form saves. */
export interface BudgetDraft {
  total: number | null;
  categories: { category: string; amount: number }[];
}

/** The latest earlier budget, offered for copying. */
export interface PreviousBudget extends BudgetDraft {
  month: string;
}

export interface BudgetHistoryMonth {
  month: string;
  total: number | null;
  spent: number;
  percent: number | null;
  status: BudgetStatus | null;
  over: number;
  categories: BudgetLine[];
}

export interface BudgetHistory {
  months: BudgetHistoryMonth[];
  comparison: {
    month: string;
    previousMonth: string;
    spent: number;
    previousSpent: number;
    difference: number;
  } | null;
  totalOverspend: number;
  oftenOver: { category: string; overMonths: number; budgetedMonths: number }[];
}

/** A threshold an expense has just carried a budget past, ready to show. */
export interface BudgetAlert {
  scope: string;
  threshold: number;
  message: string;
}

/* ---------------- Recurring transactions ---------------- */

export type RecurringKind = 'expense' | 'income';
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurringStatus = 'active' | 'paused' | 'completed';

/** A schedule as the API returns it. Dates are YYYY-MM-DD, in India time. */
export interface RecurringSchedule {
  id: string;
  kind: RecurringKind;
  description: string;
  amount: number;
  category: string | null;
  accountId: string | null;
  accountName: string | null;
  /** An account was chosen and has since been deleted; runs will fail. */
  accountMissing: boolean;
  frequency: RecurringFrequency;
  interval: number;
  startOn: string;
  /** The date it counts from, which gives its day of the month. */
  anchorOn: string;
  nextDueOn: string | null;
  endOn: string | null;
  /** Days before the due date to remind: 0, 1, 3 or 7; null is off. */
  remindDays: number | null;
  status: RecurringStatus;
  postedCount: number;
  reminderDue: boolean;
  nextDates: string[];
}

/** One due date of a schedule, and what happened to it. */
export interface RecurringRun {
  id: string;
  scheduleId: string;
  dueOn: string;
  kind: RecurringKind;
  description: string;
  amount: number;
  status: 'posted' | 'failed' | 'skipped';
  attempts: number;
  error: string | null;
  lastAttemptOn: string;
}

export type RecurringOverdue =
  | { type: 'failed'; run: RecurringRun }
  | { type: 'not-run'; schedule: RecurringSchedule };

export interface RecurringOverview {
  today: string;
  canManage: boolean;
  schedules: RecurringSchedule[];
  upcoming: RecurringSchedule[];
  overdue: RecurringOverdue[];
  recent: RecurringRun[];
  summary: {
    active: number;
    dueThisWeek: number;
    attention: number;
    monthlyOut: number;
    monthlyIn: number;
  };
}

/** What a create or edit sends. `startOn` when creating, `nextDueOn` when editing. */
export interface RecurringDraft {
  kind: RecurringKind;
  description: string;
  amount: number | null;
  category: string | null;
  accountId: string | null;
  frequency: RecurringFrequency;
  interval: number;
  startOn?: string;
  nextDueOn?: string;
  endOn: string | null;
  remindDays: number | null;
}

/** An occurrence the runner just dealt with. */
export interface RecurringOutcome {
  scheduleId: string;
  runId: string | null;
  kind: RecurringKind;
  description: string;
  amount: number;
  dueOn: string;
  status: 'posted' | 'failed' | 'exists';
  error: string | null;
  budgetAlerts?: BudgetAlert[];
}

export interface RecurringSync {
  today: string;
  added: RecurringOutcome[];
  failed: RecurringOutcome[];
  attention: number;
  reminders: RecurringSchedule[];
  budgetAlerts: BudgetAlert[];
}
