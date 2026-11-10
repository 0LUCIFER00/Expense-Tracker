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
  /** Receipts and invoices attached; only the list says how many. */
  attachmentCount?: number;
  /** Set when it came from an imported file. */
  imported?: ImportedFrom | null;
  /** Set when this is interest paid on a debt, filed by Lending & Borrowing. */
  loanRepaymentId?: string | null;
}

/** Where an imported entry came from, with the cells the app has no field for. */
export interface ImportedFrom {
  fileName: string;
  notes: string | null;
  paymentMethod: string | null;
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
  /** May create, change and delete savings goals and add or withdraw; seeing them needs nothing. */
  goalsUserAccess: boolean;
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
  whatsappRecurringReminders: false,
  goalsUserAccess: true
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
  /** Set when it came from an imported file. */
  imported?: ImportedFrom | null;
  /** Set when this is interest received on a loan, filed by Lending & Borrowing. */
  loanRepaymentId?: string | null;
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

/* ---------------- Savings goals ---------------- */

export type GoalStatus = 'active' | 'paused' | 'completed';
export type GoalState = 'on-track' | 'behind' | 'date-passed' | 'reached' | 'paused' | 'completed';
export type GoalIcon =
  | 'piggy' | 'emergency' | 'travel' | 'home' | 'vehicle'
  | 'gadget' | 'education' | 'health' | 'gift' | 'celebration';

/** A goal as the API returns it. Every figure is worked out on the server. */
export interface SavingsGoal {
  id: string;
  name: string;
  description: string | null;
  icon: GoalIcon | null;
  target: number;
  saved: number;
  remaining: number;
  /** How far past the target, when it is. */
  over: number;
  /** Whole per cent, floored. */
  percent: number;
  targetDate: string;
  monthsLeft: number;
  /** Needed each month to reach the target on time; null when not applicable. */
  monthly: number | null;
  status: GoalStatus;
  state: GoalState;
  createdOn: string;
  completedAt: string | null;
}

export interface GoalsOverview {
  today: string;
  canManage: boolean;
  goals: SavingsGoal[];
  summary: {
    totalTarget: number;
    totalSaved: number;
    percent: number;
    active: number;
    paused: number;
    completed: number;
  };
}

export interface GoalEntry {
  id: string;
  kind: 'contribution' | 'withdrawal';
  amount: number;
  date: string;
  note: string | null;
  savedAfter: number;
  createdAt: string;
}

export interface GoalDraft {
  name: string;
  description: string | null;
  icon: GoalIcon | null;
  target: number | null;
  targetDate: string;
  initialSaved?: number | null;
}

/* ---------------- Account transfers ---------------- */

/** Money moved between two of the user's own accounts. Neither income nor an expense. */
export interface AccountTransfer {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  fromType: string;
  fromName: string;
  toType: string;
  toName: string;
  amount: number;
  date: string;
  description: string | null;
  createdAt: string;
}

export interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  description: string | null;
  requestId: string;
  tzOffset: number;
}

export interface TransferResult {
  transfer: AccountTransfer;
  fromBalance: number;
  toBalance: number;
  /** True when this request had already been processed; nothing moved this time. */
  duplicate: boolean;
}

/** What deleting an account would affect, and whether it is allowed. */
export interface AccountUsage {
  name: string;
  balance: number;
  expenses: number;
  incomes: number;
  transfers: number;
  schedules: number;
  /** Lending and borrowing records, and their repayments, that used it. */
  loans?: number;
  deletable: boolean;
  reasons: string[];
}

/** An expense or income in Recently deleted, waiting to be restored or deleted for good. */
export interface DeletedEntry {
  kind: 'expense' | 'income';
  id: string;
  description: string;
  /** Integer paise, so no amount is ever off by floating point. */
  amountPaise: number;
  /** The entry's own date, as it will be when restored. */
  date: string;
  category: string | null;
  /** Null when this sign-in may not see which account. */
  account: string | null;
  /** An expense that was waiting for approval, and will again. */
  pending: boolean;
  deletedAt: string;
  deletedVia: 'user' | 'admin' | 'whatsapp';
  /** When the daily clean-up deletes it for good. */
  expiresAt: string;
  daysLeft: number;
  /** Removing it moved money, so restoring it moves it again. */
  movedMoney: boolean;
  splitMembers: number | null;
  /** For a repayment, the split expense it pays back. */
  repays: string | null;
  attachmentCount: number;
}

export interface RecycleBin {
  retentionDays: number;
  /** "Remove entries" is on: restoring and deleting for good are allowed. */
  canManage: boolean;
  entries: DeletedEntry[];
}

export interface RestoredEntry {
  kind: 'expense' | 'income';
  id: string;
  description: string;
  movedMoney: boolean;
  account: string | null;
  balanceAfter: number | null;
  budgetAlerts: BudgetAlert[];
}

/* ---------------------------------------------------------------- lending & borrowing */

export type LoanDirection = 'lent' | 'borrowed';
export type LoanStatus = 'active' | 'partial' | 'completed' | 'overdue' | 'cancelled';
export type InterestPeriod = 'month' | 'year';

export interface LoanInterest {
  type: 'none' | 'simple';
  /** A percentage, such as 1.5; null without interest. */
  rate: number | null;
  period: InterestPeriod | null;
  label: string;
}

/** A record of money given or received, with every figure worked out by the API as of today. */
export interface Loan {
  id: string;
  direction: LoanDirection;
  personName: string;
  contact: string | null;
  principal: number;
  date: string;
  dueDate: string | null;
  accountId: string;
  accountType: string;
  accountName: string;
  interest: LoanInterest;
  notes: string | null;
  status: LoanStatus;
  cancelledAt: string | null;
  cancelReason: string | null;
  principalRepaid: number;
  interestAccrued: number;
  interestPaid: number;
  totalRepaid: number;
  principalOutstanding: number;
  interestOutstanding: number;
  outstanding: number;
  /** What would be owed on the expected date if nothing more were paid; null without one. */
  outstandingAtDue: number | null;
  repaymentCount: number;
  lastPaidOn: string | null;
  /** The amount, date and interest can change only until a repayment is recorded. */
  termsEditable: boolean;
  createdAt: string;
}

export interface LoanRepayment {
  id: string;
  loanId: string;
  direction: LoanDirection | null;
  personName: string | null;
  amount: number;
  principal: number;
  interest: number;
  date: string;
  accountId: string;
  accountType: string;
  accountName: string;
  note: string | null;
  reversed: boolean;
  reversedAt: string | null;
  reversedReason: 'reversed' | 'cancelled' | null;
  createdAt: string;
}

export interface LoansSummary {
  totalLent: number;
  totalBorrowed: number;
  toReceive: number;
  toPay: number;
  interestReceived: number;
  interestPaid: number;
  interestExpected: number;
  interestOwed: number;
  overdue: number;
  open: number;
}

export interface LoansOverview {
  today: string;
  canManage: boolean;
  canBackdate: boolean;
  loans: Loan[];
  repayments: LoanRepayment[];
  summary: LoansSummary;
}

/** What the editor sends, to record or change a record. */
export interface LoanDraft {
  direction: LoanDirection;
  personName: string;
  contact: string | null;
  amount: number;
  date: string;
  accountId: string;
  dueDate: string | null;
  interest: { type: 'none' } | { type: 'simple'; rate: number; period: InterestPeriod };
  notes: string | null;
  requestId?: string;
}

export interface RepaymentDraft {
  amount: number;
  accountId: string;
  date: string;
  note: string | null;
  requestId: string;
}

/** What is owed on a date: interest due first, then principal. */
export interface LoanQuote {
  date: string;
  principalDue: number;
  interestDue: number;
  totalDue: number;
  lastPaidOn: string | null;
}
