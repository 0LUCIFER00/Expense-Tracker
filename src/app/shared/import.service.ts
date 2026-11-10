import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { DefaultKind, FileKind, RawRow } from './import/import-file';

export type ImportRowStatus = 'ready' | 'duplicate' | 'invalid';

/** One row of the file as the server read it. */
export interface PreviewRow {
  row: number;
  status: ImportRowStatus;
  kind: 'expense' | 'income' | null;
  date: string | null;
  amountPaise: number | null;
  description: string;
  category: string | null;
  accountId: string | null;
  accountName: string | null;
  notes: string;
  paymentMethod: string;
  /** 'pending' waits for approval. */
  settle: 'done' | 'pending' | null;
  /** What importing it does to its account. */
  moves: 'debit' | 'credit' | null;
  /** Why it cannot be imported; empty when it can. */
  errors: string[];
  /** Things worth knowing that do not stop it. */
  info: string[];
  duplicateOf: { source: 'existing'; date: string; description: string } | { source: 'file'; row: number } | null;
}

export interface ImportSummary {
  total: number;
  ready: number;
  duplicates: number;
  invalid: number;
  excluded: number;
  toImport: number;
  expenses: { count: number; paise: number };
  incomes: { count: number; paise: number };
  pending: number;
  accounts: { name: string; changePaise: number }[];
}

export interface PreviewResponse {
  rows: PreviewRow[];
  summary: ImportSummary;
  previousImports: { id: string; fileName: string; importedRows: number; createdAt: string }[];
  options: {
    expenseCategories: string[];
    incomeCategories: string[];
    accounts: { id: string; name: string; type: string }[];
  };
  canSeeBalances: boolean;
}

export interface ChunkResult {
  results: { row: number; status: 'imported' | 'failed'; kind: 'expense' | 'income' | null; error?: string; already?: boolean }[];
  batch: { importedRows: number; failedRows: number };
  budgetAlerts: { scope: string; threshold: number; message: string }[];
}

export interface ImportRequestBase {
  defaultKind: DefaultKind;
  updateBalances: boolean;
}

@Injectable({ providedIn: 'root' })
export class ImportService {
  private readonly api = inject(ApiService);

  /** Checks every row; imports nothing. */
  preview(base: ImportRequestBase & { fileHash: string }, rows: RawRow[]): Observable<PreviewResponse> {
    return this.api.post<PreviewResponse>('/imports/preview', {
      ...base,
      tzOffset: new Date().getTimezoneOffset(),
      rows
    });
  }

  /**
   * Imports one chunk under `batchId`. Sending the same chunk again is safe:
   * rows already imported under that id are reported, not added twice.
   */
  importChunk(
    batchId: string,
    file: { fileName: string; fileHash: string; fileType: FileKind; totalRows: number },
    base: ImportRequestBase,
    rows: RawRow[]
  ): Observable<ChunkResult> {
    return this.api.post<ChunkResult>(`/imports/${batchId}/rows`, {
      ...file,
      ...base,
      tzOffset: new Date().getTimezoneOffset(),
      rows
    });
  }
}
