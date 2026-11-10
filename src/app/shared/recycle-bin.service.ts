import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { DeletedEntry, RecycleBin, RestoredEntry } from './models';

/** Recently deleted: what was removed in the last 30 days, and putting it back. */
@Injectable({ providedIn: 'root' })
export class RecycleBinService {
  private readonly api = inject(ApiService);

  list(): Observable<RecycleBin> {
    return this.api.get<RecycleBin>('/recycle-bin');
  }

  /** Puts it back as it was, moving its money again. Refused (409) with a reason when that cannot be done safely. */
  restore(entry: Pick<DeletedEntry, 'kind' | 'id'>): Observable<RestoredEntry> {
    return this.api.post<RestoredEntry>(`/recycle-bin/${entry.kind}/${entry.id}/restore`);
  }

  /** Deletes it for good. */
  purge(entry: Pick<DeletedEntry, 'kind' | 'id'>): Observable<{ purged: number }> {
    return this.api.delete<{ purged: number }>(`/recycle-bin/${entry.kind}/${entry.id}`);
  }

  /** Deletes everything in Recently deleted for good. */
  empty(): Observable<{ purged: number }> {
    return this.api.post<{ purged: number }>('/recycle-bin/empty', { confirm: 'empty' });
  }
}
