import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { Toast, ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
  });

  function shown(): Promise<Toast[]> {
    return firstValueFrom(service.toasts$);
  }

  it('starts with nothing on screen', async () => {
    expect(await shown()).toEqual([]);
  });

  it('shows a success with its text', async () => {
    service.success('Expense added.');

    const toasts = await shown();

    expect(toasts.length).toBe(1);
    expect(toasts[0].kind).toBe('success');
    expect(toasts[0].text).toBe('Expense added.');
  });

  it('shows an error as an error', async () => {
    service.error('Insufficient balance.');

    expect((await shown())[0].kind).toBe('error');
  });

  it('ignores an empty or blank message', async () => {
    service.success('');
    service.error('   ');

    expect(await shown()).toEqual([]);
  });

  it('gives each one its own id', async () => {
    service.success('one');
    service.success('two');

    const [first, second] = await shown();

    expect(first.id).not.toBe(second.id);
  });

  it('dismisses the one asked for and leaves the rest', async () => {
    service.success('one');
    service.success('two');

    const [first] = await shown();
    service.dismiss(first.id);

    const left = await shown();

    expect(left.length).toBe(1);
    expect(left[0].text).toBe('two');
  });

  it('ignores a dismiss for something already gone', async () => {
    service.success('one');
    const [only] = await shown();

    service.dismiss(only.id);
    service.dismiss(only.id);

    expect(await shown()).toEqual([]);
  });

  // A burst of failures should not end up covering the page.
  it('keeps at most three, dropping the oldest', async () => {
    for (const text of ['one', 'two', 'three', 'four']) {
      service.success(text);
    }

    const toasts = await shown();

    expect(toasts.map(t => t.text)).toEqual(['two', 'three', 'four']);
  });

  it('clears itself after its time is up', fakeAsync(async () => {
    service.success('Saved.');

    tick(3999);
    expect((await shown()).length).toBe(1);

    tick(1);
    expect(await shown()).toEqual([]);
  }));

  // There is more to read in a failure than in "Saved."
  it('leaves an error up longer than a success', fakeAsync(async () => {
    service.error('Something went wrong.');

    tick(4000);
    expect((await shown()).length).toBe(1);

    tick(3000);
    expect(await shown()).toEqual([]);
  }));

  it('does not clear a later toast when an earlier one expires', fakeAsync(async () => {
    service.success('first');
    tick(2000);
    service.success('second');

    tick(2000);

    const left = await shown();

    expect(left.length).toBe(1);
    expect(left[0].text).toBe('second');
  }));

  // Dismissing by hand must cancel the timer, or it would later clear whatever
  // had taken that toast's place.
  it('cancels the timer of one dismissed by hand', fakeAsync(async () => {
    service.success('first');
    const [first] = await shown();

    service.dismiss(first.id);
    service.success('second');

    tick(3000);

    expect((await shown()).map(t => t.text)).toEqual(['second']);

    tick(1000);
    expect(await shown()).toEqual([]);
  }));
});
