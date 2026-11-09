import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpEventType } from '@angular/common/http';
import { AttachmentPickerComponent } from './attachment-picker.component';
import { MAX_FILE_BYTES, prepareFile } from '../attachment.service';

/** A real PNG of the given size, drawn on a canvas. */
function png(width: number, height: number, name = 'photo.png'): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#336699';
  ctx.fillRect(0, 0, width, height);
  return new Promise(resolve => canvas.toBlob(blob => resolve(new File([blob!], name, { type: 'image/png' })), 'image/png'));
}

const pdf = (bytes = 200) => new File([new Uint8Array(bytes)], 'invoice.pdf', { type: 'application/pdf' });

describe('prepareFile', () => {
  it('passes a small photo and a PDF through unchanged', async () => {
    const photo = await png(40, 30);
    const ready = await prepareFile(photo);
    expect('blob' in ready && ready.blob).toBe(photo);

    const doc = pdf();
    const readyPdf = await prepareFile(doc);
    expect('blob' in readyPdf && readyPdf.name).toBe('invoice.pdf');
  });

  it('shrinks a very large photo to a JPEG no wider than 2560 px', async () => {
    const big = await png(3200, 400, 'scan.png');
    const ready = await prepareFile(big);

    expect('blob' in ready).toBeTrue();
    if ('blob' in ready) {
      expect(ready.blob.type).toBe('image/jpeg');
      expect(ready.name).toBe('scan.jpg');
    }
  });

  it('refuses other types and a PDF over 4 MB, saying why', async () => {
    const gif = await prepareFile(new File(['GIF89a'], 'a.gif', { type: 'image/gif' }));
    expect('error' in gif && gif.error).toContain('only JPG, PNG, WebP images and PDF');

    const huge = await prepareFile(pdf(MAX_FILE_BYTES + 1));
    expect('error' in huge && huge.error).toContain('over 4 MB');
  });
});

describe('AttachmentPickerComponent', () => {
  let fixture: ComponentFixture<AttachmentPickerComponent>;
  let picker: AttachmentPickerComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AttachmentPickerComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AttachmentPickerComponent);
    picker = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;

  it('offers file selection for images and PDFs, several at once', () => {
    const input = el().querySelector('input[type=file]') as HTMLInputElement;
    expect(input.multiple).toBeTrue();
    expect(input.accept).toContain('application/pdf');
    expect(el().textContent).toContain('Attach receipt');
  });

  describe('inline, as on Add Expense', () => {
    beforeEach(() => {
      picker.inline = true;
      fixture.detectChanges();
    });

    it('is one line: what to attach, and an Attach button for several files', () => {
      const input = el().querySelector('.inline-btn input[type=file]') as HTMLInputElement;
      expect(input.multiple).toBeTrue();
      expect(el().querySelector('.inline-text')!.textContent).toContain('Attach receipt');
      expect(el().querySelector('.files')).toBeNull();
    });

    it('shows waiting files as thumbnails that can be taken out', async () => {
      await picker.add([await png(20, 20, 'a.png'), pdf()]);
      fixture.detectChanges();

      expect(el().querySelectorAll('.mini').length).toBe(2);
      expect(el().querySelector('.mini img')).not.toBeNull();
      expect(el().querySelector('.inline-text')!.textContent).toContain('2 receipts ready');
      expect(el().querySelector('.inline-text')!.textContent).toContain('Attached when you save');

      (el().querySelector('.mini-x') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(el().querySelector('.inline-text')!.textContent).toContain('1 receipt ready');
    });

    it('says what is wrong with a file it cannot take', async () => {
      await picker.add([new File(['GIF89a'], 'cat.gif', { type: 'image/gif' })]);
      fixture.detectChanges();

      const note = el().querySelector('.inline-text .err') as HTMLElement;
      expect(note.textContent).toContain('cat.gif');
      expect(note.getAttribute('role')).toBe('alert');
    });
  });

  it('holds files until the expense exists, then sends each with progress', async () => {
    await picker.add([await png(20, 20, 'a.png'), pdf()]);
    fixture.detectChanges();
    expect(el().querySelectorAll('.file').length).toBe(2);
    expect(el().textContent).toContain('attached when you save');
    http.expectNone(() => true);

    const sending = picker.uploadAll('e1');

    const first = http.expectOne('/api/expenses/e1/attachments');
    expect(first.request.headers.get('X-File-Name')).toBe('a.png');
    first.event({ type: HttpEventType.UploadProgress, loaded: 5, total: 10 });
    expect(picker.items[0].progress).toBe(50);
    first.flush({ id: 'x1', expenseId: 'e1', fileName: 'a.png', contentType: 'image/png', size: 10, createdAt: '' });
    await Promise.resolve();
    await new Promise(r => setTimeout(r));

    http.expectOne('/api/expenses/e1/attachments').flush({ id: 'x2', expenseId: 'e1', fileName: 'invoice.pdf', contentType: 'application/pdf', size: 200, createdAt: '' });

    expect(await sending).toEqual({ sent: 2, failed: 0 });
    expect(picker.items.every(i => i.state === 'done')).toBeTrue();
  });

  it('shows the server\'s refusal against that file', async () => {
    await picker.add([pdf()]);
    const sending = picker.uploadAll('e1');

    http.expectOne('/api/expenses/e1/attachments')
      .flush({ error: 'That PDF looks damaged or incomplete.' }, { status: 415, statusText: 'Unsupported' });

    expect(await sending).toEqual({ sent: 0, failed: 1 });
    fixture.detectChanges();
    expect(el().querySelector('.err')!.textContent).toContain('damaged or incomplete');
  });

  it('a file can be taken out before it is sent', async () => {
    await picker.add([pdf()]);
    picker.remove(picker.items[0]);
    expect(picker.items.length).toBe(0);
  });

  it('says when there is no more room', async () => {
    picker.room = 1;
    await picker.add([pdf(), pdf()]);
    expect(picker.notice).toContain('Only 1 more file fits');
    expect(picker.items.length).toBe(1);
  });

  it('with an expense set, uploads as soon as a file is added', async () => {
    picker.expenseId = 'e9';
    let uploaded = '';
    picker.uploaded.subscribe(a => (uploaded = a.id));

    const adding = picker.add([pdf()]);
    await new Promise(r => setTimeout(r));
    http.expectOne('/api/expenses/e9/attachments').flush({ id: 'z', expenseId: 'e9', fileName: 'invoice.pdf', contentType: 'application/pdf', size: 200, createdAt: '' });
    await adding;

    expect(uploaded).toBe('z');
  });
});
