import { splitAmount } from './split';

/*
 * The form previews the shares before the expense is saved, and the server
 * works them out again. These are the same cases server/test/split.test.mjs
 * holds the server to, so the preview cannot promise one figure and the saved
 * entry show another.
 */
describe('splitAmount', () => {
  it('₹1,455 between four: the others pay ₹364 and yours is ₹363', () => {
    expect(splitAmount(1455, 4)).toEqual({ members: 4, share: 364, personal: 363 });
  });

  it('lets the owner absorb the rounding the other way too', () => {
    expect(splitAmount(1000, 3)).toEqual({ members: 3, share: 333, personal: 334 });
  });

  it('falls back to paise rather than asking the others for more than the bill', () => {
    expect(splitAmount(9, 6)).toEqual({ members: 6, share: 1.5, personal: 1.5 });
  });

  it('always adds back up to the amount', () => {
    for (const amount of [1, 7, 99.99, 1455, 33333.33]) {
      for (let members = 2; members <= 12; members += 1) {
        const preview = splitAmount(amount, members)!;
        const back = Math.round((preview.share * (members - 1) + preview.personal) * 100);

        expect(back).withContext(`${amount} ÷ ${members}`).toBe(Math.round(amount * 100));
      }
    }
  });

  it('shows nothing until there is something to divide', () => {
    expect(splitAmount(0, 4)).toBeNull();
    expect(splitAmount(1455, 1)).toBeNull();
    expect(splitAmount(1455, 2.5)).toBeNull();
    expect(splitAmount(Number.NaN, 4)).toBeNull();
  });
});
