import { BudgetMonth, Expense, GoalsOverview, SplitSummary } from './models';

/**
 * What the dashboard shows, worked out once by HomeComponent and handed to
 * whichever layout is in use.
 *
 * The two layouts arrange the same facts differently; keeping the arithmetic
 * out of them means a figure cannot come out different depending on which one
 * you happen to be looking at.
 */

/** One of the account rows, with its share of the largest for the bar. */
export interface DashboardAccount {
  name: string;
  kind: string;
  /** Null when this session may not see amounts. */
  balance: number | null;
  share: number;
}

/** One category's spending this month, as a share of the largest. */
export interface DashboardCategory {
  name: string;
  total: number;
  share: number;
  /** Position in the colour ramp, 0 being the largest. */
  tone: number;
}

/** One day on the dashboard's recent-spending chart. */
export interface DashboardDay {
  /** Midnight local time, for the label. */
  date: Date;
  total: number;
  /** Height as a percentage of the busiest day in the window. */
  height: number;
  isToday: boolean;
}

export interface DashboardData {
  today: Date;
  monthName: string;
  lastMonthName: string;

  /** Settled spending in the month being shown. */
  spent: number;
  /** And the month before, which the delta is measured against. */
  lastMonthSpent: number;
  /** The gap to last month as a positive figure; `spentMore` carries the sign. */
  difference: number;
  spentMore: boolean;
  /** Spend so far this month over the days elapsed, not the whole month. */
  dailyAverage: number;
  entries: number;

  accounts: DashboardAccount[];
  accountsTotal: number;
  canSeeBalances: boolean;

  categories: DashboardCategory[];
  recent: Expense[];
  /** Split expenses by id, with their repayments, for recent rows that open. */
  splits: Record<string, SplitSummary>;

  /** The last fortnight, a bar each, so a quiet month still reads as a chart. */
  days: DashboardDay[];
  /** The busiest day's spending, which the chart's bars are scaled against. */
  busiestDay: number;

  /**
   * What the month would come to at the rate so far. Null for the first few
   * days, when one quiet or busy day still swings it too far to mean anything.
   */
  projected: number | null;
  /** Entries waiting for an admin to approve them. */
  pending: number;

  /** True while there is a phone to connect and nothing connected yet. */
  offerWhatsapp: boolean;

  /** Savings goals for the Home card. Null when they could not be loaded. */
  goals?: GoalsOverview | null;

  /**
   * This month's budget, worked out by the API, for the Budget card. Null when
   * it could not be loaded, in which case the card stays out of the way.
   */
  budget?: BudgetMonth | null;
}
