export interface Expense {
  id?: number;

  amount: number;
  description: string;
  date: Date | string;

  source?: string;
  sourceId?: any;
  sourceType?: string | null;
  sourceCategory?: string | null;

  expenseAccess?: boolean;
  updatePermission?: boolean;

  balanceUpdated?: boolean;

  status?: 'Done' | 'Pending / Waiting Admin';
  remarks?: string;

  isPendingApproval?: boolean;
  createdAt?: string;
}